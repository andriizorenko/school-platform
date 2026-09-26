import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  liveSessions,
  parentProfiles,
  progressReportRequests,
  progressReports,
  studentSubjectEnrollments,
  students,
  subjects,
  teacherAssignments,
  teacherProfiles,
} from "@school/db";
import type { Database } from "@school/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database/database.constants";
import type { AuthUser } from "../auth/types";
import { AuditService } from "../audit/audit.service";
import { OutboxService } from "../audit/outbox.service";
import type { CompleteProgressReportDto } from "./dto/complete-progress-report.dto";
import type { RequestProgressReportDto } from "./dto/request-progress-report.dto";
import type { UpdateReportVisibilityDto } from "./dto/update-report-visibility.dto";

const PRIVILEGED_ROLES = new Set(["ADMIN", "MANAGER", "SUPPORT_MANAGER"]);

@Injectable()
export class ReportsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  private async reportRequestMinimum(db: Database = this.db) {
    const result = await db.execute(sql`
      SELECT COALESCE(
        (SELECT (value #>> '{}')::int FROM school_settings WHERE key = 'report_request_min_lessons'),
        5
      ) AS required_count
    `);
    return Math.max(1, Number((result.rows[0] as any)?.required_count ?? 5));
  }

  async requestEligibility(studentId: string, actor: AuthUser) {
    if (!actor.roles.includes("PARENT")) {
      throw new ForbiddenException({ code: "REPORT_ELIGIBILITY_PARENT_ONLY", message: "Only the parent account can view report request eligibility" });
    }

    const requiredCount = await this.reportRequestMinimum();
    const rows = await this.db.execute(sql`
      SELECT
        e.id AS enrollment_id,
        e.status AS enrollment_status,
        e.subject_id,
        sub.name AS subject_name,
        ta.teacher_id,
        st.family_id AS student_family_id,
        pp.family_id AS parent_family_id,
        COALESCE((
          SELECT COUNT(*)::int
          FROM live_sessions s
          WHERE s.enrollment_id = e.id
            AND s.session_type = 'REGULAR'
            AND s.status = 'COMPLETED'
            AND s.starts_at > COALESCE(
              (
                SELECT MAX(r.created_at)
                FROM progress_reports r
                WHERE r.student_id = st.id
                  AND r.subject_id = e.subject_id
                  AND r.report_type = 'REQUESTED'
              ),
              '-infinity'::timestamptz
            )
        ), 0)::int AS completed_count,
        rr.id AS pending_request_id,
        rr.target_session_id AS pending_target_session_id,
        rr.visible_to_student AS pending_visible_to_student,
        rr.created_at AS pending_created_at,
        target.starts_at AS pending_target_starts_at,
        (
          SELECT MIN(ls.starts_at)
          FROM live_sessions ls
          WHERE ls.enrollment_id = e.id
            AND ls.session_type = 'REGULAR'
            AND ls.status = 'SCHEDULED'
            AND ls.starts_at > now()
        ) AS next_regular_lesson_at
      FROM student_subject_enrollments e
      JOIN students st ON st.id = e.student_id
      JOIN parent_profiles pp ON pp.user_id = ${actor.id}
      JOIN subjects sub ON sub.id = e.subject_id
      LEFT JOIN teacher_assignments ta ON ta.enrollment_id = e.id AND ta.ended_at IS NULL
      LEFT JOIN progress_report_requests rr
        ON rr.student_id = st.id
       AND rr.subject_id = e.subject_id
       AND rr.status = 'PENDING'
      LEFT JOIN live_sessions target ON target.id = rr.target_session_id
      WHERE st.id = ${studentId}
      ORDER BY sub.name
    `);

    if (!rows.rowCount) {
      const student = await this.db.execute(sql`SELECT id, family_id FROM students WHERE id=${studentId} LIMIT 1`);
      if (!student.rowCount) throw new NotFoundException({ code: "STUDENT_NOT_FOUND", message: "Student not found" });
      const family = (student.rows[0] as any).family_id;
      const parent = await this.db.execute(sql`SELECT family_id FROM parent_profiles WHERE user_id=${actor.id} LIMIT 1`);
      if (!parent.rowCount || (parent.rows[0] as any).family_id !== family) {
        throw new ForbiddenException({ code: "REPORT_SCOPE_DENIED", message: "You cannot view report eligibility for this student" });
      }
      return [];
    }

    const first = rows.rows[0] as any;
    if (first.parent_family_id !== first.student_family_id) {
      throw new ForbiddenException({ code: "REPORT_SCOPE_DENIED", message: "You cannot view report eligibility for this student" });
    }

    return (rows.rows as any[]).map((row) => {
      const completedCount = Number(row.completed_count ?? 0);
      const remainingCount = Math.max(0, requiredCount - completedCount);
      let status: "AVAILABLE" | "PENDING" | "TOO_EARLY" | "INACTIVE" | "NO_TEACHER" = "AVAILABLE";
      if (row.pending_request_id) status = "PENDING";
      else if (row.enrollment_status !== "ACTIVE") status = "INACTIVE";
      else if (!row.teacher_id) status = "NO_TEACHER";
      else if (completedCount < requiredCount) status = "TOO_EARLY";

      return {
        enrollmentId: row.enrollment_id,
        subjectId: row.subject_id,
        subjectName: row.subject_name,
        enrollmentStatus: row.enrollment_status,
        status,
        completedLessonsSincePreviousReport: completedCount,
        requiredLessons: requiredCount,
        remainingLessons: remainingCount,
        nextRegularLessonAt: row.next_regular_lesson_at,
        pendingRequest: row.pending_request_id ? {
          id: row.pending_request_id,
          targetSessionId: row.pending_target_session_id,
          targetStartsAt: row.pending_target_starts_at,
          visibleToStudent: row.pending_visible_to_student,
          createdAt: row.pending_created_at,
        } : null,
      };
    });
  }

  async requestProgressReport(studentId: string, dto: RequestProgressReportDto, actor: AuthUser, requestId?: string) {
    if (!actor.roles.includes("PARENT")) {
      throw new ForbiddenException({ code: "REPORT_REQUEST_PARENT_ONLY", message: "Only the parent account can request a progress report" });
    }

    return this.db.transaction(async (tx) => {
      const scopeResult = await tx.execute(sql`
        SELECT
          st.id AS student_id,
          st.first_name,
          st.last_name,
          st.user_id AS student_user_id,
          pp.family_id AS parent_family_id,
          st.family_id AS student_family_id,
          e.id AS enrollment_id,
          e.status AS enrollment_status,
          sub.name AS subject_name,
          ta.teacher_id
        FROM students st
        JOIN parent_profiles pp ON pp.user_id = ${actor.id}
        JOIN student_subject_enrollments e ON e.student_id = st.id AND e.subject_id = ${dto.subjectId}
        JOIN subjects sub ON sub.id = e.subject_id
        LEFT JOIN teacher_assignments ta ON ta.enrollment_id = e.id AND ta.ended_at IS NULL
        WHERE st.id = ${studentId}
        LIMIT 1
      `);
      if (!scopeResult.rowCount) {
        throw new NotFoundException({ code: "STUDENT_ENROLLMENT_NOT_FOUND", message: "Student subject enrollment not found" });
      }
      const row = scopeResult.rows[0] as {
        student_id: string;
        first_name: string;
        last_name: string;
        student_user_id: string | null;
        parent_family_id: string;
        student_family_id: string;
        enrollment_id: string;
        enrollment_status: string;
        subject_name: string;
        teacher_id: string | null;
      };
      if (row.parent_family_id !== row.student_family_id) {
        throw new ForbiddenException({ code: "REPORT_SCOPE_DENIED", message: "You cannot request a report for this student" });
      }
      if (row.enrollment_status !== "ACTIVE") {
        throw new ConflictException({ code: "REPORT_ENROLLMENT_NOT_ACTIVE", message: "Progress report can be requested only for active tutoring" });
      }
      if (!row.teacher_id) {
        throw new ConflictException({ code: "REPORT_TEACHER_REQUIRED", message: "The enrollment has no active primary teacher" });
      }

      const existingPending = await tx.execute(sql`
        SELECT id
        FROM progress_report_requests
        WHERE student_id = ${studentId}
          AND subject_id = ${dto.subjectId}
          AND status = 'PENDING'
        LIMIT 1
        FOR UPDATE
      `);
      if (existingPending.rowCount) {
        throw new ConflictException({ code: "REPORT_REQUEST_ALREADY_PENDING", message: "A progress report request is already pending" });
      }

      const settingResult = await tx.execute(sql`
        SELECT COALESCE(
          (SELECT (value #>> '{}')::int FROM school_settings WHERE key = 'report_request_min_lessons'),
          5
        ) AS required_count
      `);
      const requiredCount = Math.max(1, Number((settingResult.rows[0] as any)?.required_count ?? 5));

      const lessonCountResult = await tx.execute(sql`
        SELECT COUNT(*)::int AS completed_count
        FROM live_sessions s
        WHERE s.enrollment_id = ${row.enrollment_id}
          AND s.session_type = 'REGULAR'
          AND s.status = 'COMPLETED'
          AND s.starts_at > COALESCE(
            (
              SELECT MAX(r.created_at)
              FROM progress_reports r
              WHERE r.student_id = ${studentId}
                AND r.subject_id = ${dto.subjectId}
                AND r.report_type = 'REQUESTED'
            ),
            '-infinity'::timestamptz
          )
      `);
      const completedCount = Number((lessonCountResult.rows[0] as { completed_count: number | string }).completed_count);
      if (completedCount < requiredCount) {
        throw new ConflictException({
          code: "REPORT_REQUEST_TOO_EARLY",
          message: "Not enough regular lessons have been completed since the previous report",
          details: { completedCount, requiredCount },
        });
      }

      const targetResult = await tx.execute(sql`
        SELECT id, starts_at, ends_at, actual_teacher_id
        FROM live_sessions
        WHERE enrollment_id = ${row.enrollment_id}
          AND session_type = 'REGULAR'
          AND status = 'SCHEDULED'
          AND starts_at > now()
        ORDER BY starts_at ASC
        LIMIT 1
      `);
      const target = targetResult.rowCount
        ? targetResult.rows[0] as { id: string; starts_at: Date; ends_at: Date; actual_teacher_id: string }
        : null;

      const [request] = await tx
        .insert(progressReportRequests)
        .values({
          studentId,
          subjectId: dto.subjectId,
          enrollmentId: row.enrollment_id,
          requestedByParentId: actor.id,
          targetSessionId: target?.id,
          visibleToStudent: dto.visibleToStudent ?? true,
          status: "PENDING",
        })
        .returning();

      const teacherRecipient = target?.actual_teacher_id ?? row.teacher_id;
      const targetStartsAt = target?.starts_at ? new Date(target.starts_at) : null;
      await this.outbox.publishNotification(
        {
          aggregateType: "ProgressReportRequest",
          aggregateId: request.id,
          recipientUserIds: [teacherRecipient],
          eventType: "REPORT_REQUESTED",
          title: "Потрібен звіт про успішність",
          body: `${row.first_name} ${row.last_name} · ${row.subject_name}${targetStartsAt ? ` · найближче заняття ${targetStartsAt.toISOString()}` : ""}`,
          actionPath: `/teacher/students/${studentId}`,
          entityType: "ProgressReportRequest",
          entityId: request.id,
          data: { studentId, subjectId: dto.subjectId, targetSessionId: target?.id ?? null },
        },
        tx,
      );

      await this.audit.record(
        {
          actorUserId: actor.id,
          actorRoleCode: actor.roles[0],
          action: "REQUEST_PROGRESS_REPORT",
          entityType: "ProgressReportRequest",
          entityId: request.id,
          requestId,
          afterData: {
            studentId,
            subjectId: dto.subjectId,
            enrollmentId: row.enrollment_id,
            targetSessionId: target?.id ?? null,
            visibleToStudent: request.visibleToStudent,
            completedLessonsSincePreviousReport: completedCount,
          },
        },
        tx,
      );

      return { ...request, completedLessonsSincePreviousReport: completedCount };
    });
  }

  async completeRequestedReport(reportRequestId: string, dto: CompleteProgressReportDto, actor: AuthUser, requestId?: string) {
    return this.db.transaction(async (tx) => {
      const locked = await tx.execute(sql`
        SELECT
          rr.id,
          rr.student_id,
          rr.subject_id,
          rr.enrollment_id,
          rr.requested_by_parent_id,
          rr.target_session_id,
          rr.visible_to_student,
          rr.status,
          st.first_name,
          st.last_name,
          st.user_id AS student_user_id,
          sub.name AS subject_name,
          s.status AS target_session_status,
          s.actual_teacher_id AS target_teacher_id,
          ta.teacher_id AS primary_teacher_id
        FROM progress_report_requests rr
        JOIN students st ON st.id = rr.student_id
        JOIN subjects sub ON sub.id = rr.subject_id
        LEFT JOIN live_sessions s ON s.id = rr.target_session_id
        LEFT JOIN teacher_assignments ta ON ta.enrollment_id = rr.enrollment_id AND ta.ended_at IS NULL
        WHERE rr.id = ${reportRequestId}
        FOR UPDATE OF rr
      `);
      if (!locked.rowCount) throw new NotFoundException({ code: "REPORT_REQUEST_NOT_FOUND", message: "Progress report request not found" });
      const row = locked.rows[0] as any;
      if (row.status !== "PENDING") {
        throw new ConflictException({ code: "REPORT_REQUEST_NOT_PENDING", message: "Progress report request is no longer pending" });
      }
      if (!row.target_session_id) {
        throw new ConflictException({ code: "REPORT_TARGET_LESSON_REQUIRED", message: "The request has no upcoming regular lesson assigned yet" });
      }
      if (row.target_session_status !== "COMPLETED") {
        throw new ConflictException({
          code: "REPORT_TARGET_LESSON_NOT_COMPLETED",
          message: "Complete the target regular lesson before submitting the progress report",
        });
      }

      const privileged = actor.roles.some((role) => PRIVILEGED_ROLES.has(role));
      const allowedTeacher = actor.roles.includes("TEACHER") && (actor.id === row.target_teacher_id || actor.id === row.primary_teacher_id);
      if (!privileged && !allowedTeacher) {
        throw new ForbiddenException({ code: "REPORT_COMPLETE_SCOPE_DENIED", message: "You cannot complete this progress report" });
      }

      const createdByTeacherId = allowedTeacher ? actor.id : (row.target_teacher_id ?? row.primary_teacher_id);
      if (!createdByTeacherId) {
        throw new ConflictException({ code: "REPORT_TEACHER_REQUIRED", message: "No teacher is available for this report" });
      }

      const [report] = await tx
        .insert(progressReports)
        .values({
          studentId: row.student_id,
          subjectId: row.subject_id,
          sessionId: row.target_session_id,
          reportType: "REQUESTED",
          strengths: dto.strengths.trim(),
          gaps: dto.gaps.trim(),
          actionPlan: dto.actionPlan.trim(),
          visibleToParent: true,
          visibleToStudent: row.visible_to_student,
          createdByTeacherId,
        })
        .returning();

      const [updatedRequest] = await tx
        .update(progressReportRequests)
        .set({ status: "COMPLETED", reportId: report.id, completedAt: new Date() })
        .where(eq(progressReportRequests.id, reportRequestId))
        .returning();

      const recipients = [row.requested_by_parent_id as string];
      if (row.visible_to_student && row.student_user_id) recipients.push(row.student_user_id);
      await this.outbox.publishNotification(
        {
          aggregateType: "ProgressReport",
          aggregateId: report.id,
          recipientUserIds: recipients,
          eventType: "REPORT_READY",
          title: "Звіт про успішність готовий",
          body: `${row.first_name} ${row.last_name} · ${row.subject_name}`,
          actionPath: `/parent/students/${row.student_id}/reports`,
          entityType: "ProgressReport",
          entityId: report.id,
          data: { studentId: row.student_id, subjectId: row.subject_id },
        },
        tx,
      );

      await this.audit.record(
        {
          actorUserId: actor.id,
          actorRoleCode: actor.roles[0],
          action: "COMPLETE_PROGRESS_REPORT",
          entityType: "ProgressReport",
          entityId: report.id,
          requestId,
          afterData: { reportRequestId, visibleToStudent: report.visibleToStudent, targetSessionId: row.target_session_id },
        },
        tx,
      );

      return { request: updatedRequest, report };
    });
  }

  async listForStudent(studentId: string, actor: AuthUser) {
    const access = await this.resolveStudentAccess(studentId, actor);
    const conditions = [eq(progressReports.studentId, studentId)];
    if (access === "PARENT") conditions.push(eq(progressReports.visibleToParent, true));
    if (access === "STUDENT") conditions.push(eq(progressReports.visibleToStudent, true));
    if (access === "TEACHER") {
      conditions.push(sql`EXISTS (
        SELECT 1
        FROM student_subject_enrollments e
        LEFT JOIN teacher_assignments ta ON ta.enrollment_id = e.id AND ta.ended_at IS NULL
        WHERE e.student_id = ${studentId}
          AND e.subject_id = ${progressReports.subjectId}
          AND (
            ta.teacher_id = ${actor.id}
            OR EXISTS (
              SELECT 1 FROM live_sessions ls
              WHERE ls.enrollment_id = e.id AND ls.actual_teacher_id = ${actor.id}
            )
          )
      )`);
    }

    return this.db
      .select({
        id: progressReports.id,
        subjectId: progressReports.subjectId,
        subjectName: subjects.name,
        sessionId: progressReports.sessionId,
        reportType: progressReports.reportType,
        strengths: progressReports.strengths,
        gaps: progressReports.gaps,
        actionPlan: progressReports.actionPlan,
        visibleToParent: progressReports.visibleToParent,
        visibleToStudent: progressReports.visibleToStudent,
        createdByTeacherId: progressReports.createdByTeacherId,
        teacherFirstName: teacherProfiles.firstName,
        teacherLastName: teacherProfiles.lastName,
        createdAt: progressReports.createdAt,
      })
      .from(progressReports)
      .innerJoin(subjects, eq(progressReports.subjectId, subjects.id))
      .innerJoin(teacherProfiles, eq(progressReports.createdByTeacherId, teacherProfiles.userId))
      .where(and(...conditions))
      .orderBy(desc(progressReports.createdAt));
  }

  async pendingForTeacher(actor: AuthUser) {
    if (actor.roles.some((role) => PRIVILEGED_ROLES.has(role))) {
      return this.pendingRequestsQuery();
    }
    if (!actor.roles.includes("TEACHER")) {
      throw new ForbiddenException({ code: "REPORT_PENDING_SCOPE_DENIED", message: "Pending report list is not available for this role" });
    }
    return this.pendingRequestsQuery(actor.id);
  }

  private async pendingRequestsQuery(teacherId?: string) {
    const teacherCondition = teacherId
      ? sql`AND COALESCE(s.actual_teacher_id, ta.teacher_id) = ${teacherId}`
      : sql``;
    const result = await this.db.execute(sql`
      SELECT
        rr.id,
        rr.student_id,
        st.first_name,
        st.last_name,
        rr.subject_id,
        sub.name AS subject_name,
        rr.target_session_id,
        s.starts_at AS target_starts_at,
        rr.visible_to_student,
        rr.created_at
      FROM progress_report_requests rr
      JOIN students st ON st.id = rr.student_id
      JOIN subjects sub ON sub.id = rr.subject_id
      LEFT JOIN live_sessions s ON s.id = rr.target_session_id
      LEFT JOIN teacher_assignments ta ON ta.enrollment_id = rr.enrollment_id AND ta.ended_at IS NULL
      WHERE rr.status = 'PENDING'
      ${teacherCondition}
      ORDER BY COALESCE(s.starts_at, rr.created_at) ASC
    `);
    return result.rows;
  }

  async updateVisibility(reportId: string, dto: UpdateReportVisibilityDto, actor: AuthUser, requestId?: string) {
    if (!actor.roles.includes("PARENT")) {
      throw new ForbiddenException({ code: "REPORT_VISIBILITY_PARENT_ONLY", message: "Only the parent account can change student report visibility" });
    }

    return this.db.transaction(async (tx) => {
      const result = await tx.execute(sql`
        SELECT r.id, r.student_id, r.visible_to_student, st.user_id AS student_user_id, st.family_id, pp.family_id AS parent_family_id,
               st.first_name, st.last_name, sub.name AS subject_name
        FROM progress_reports r
        JOIN students st ON st.id = r.student_id
        JOIN parent_profiles pp ON pp.user_id = ${actor.id}
        JOIN subjects sub ON sub.id = r.subject_id
        WHERE r.id = ${reportId}
        FOR UPDATE OF r
      `);
      if (!result.rowCount) throw new NotFoundException({ code: "REPORT_NOT_FOUND", message: "Progress report not found" });
      const row = result.rows[0] as any;
      if (row.family_id !== row.parent_family_id) {
        throw new ForbiddenException({ code: "REPORT_SCOPE_DENIED", message: "You cannot change this report" });
      }

      const [updated] = await tx
        .update(progressReports)
        .set({ visibleToStudent: dto.visibleToStudent })
        .where(eq(progressReports.id, reportId))
        .returning();

      if (!row.visible_to_student && dto.visibleToStudent && row.student_user_id) {
        await this.outbox.publishNotification(
          {
            aggregateType: "ProgressReport",
            aggregateId: reportId,
            recipientUserIds: [row.student_user_id],
            eventType: "REPORT_READY",
            title: "Звіт про успішність доступний",
            body: `${row.first_name} ${row.last_name} · ${row.subject_name}`,
            actionPath: "/student/reports",
            entityType: "ProgressReport",
            entityId: reportId,
          },
          tx,
        );
      }

      await this.audit.record(
        {
          actorUserId: actor.id,
          actorRoleCode: actor.roles[0],
          action: "CHANGE_REPORT_STUDENT_VISIBILITY",
          entityType: "ProgressReport",
          entityId: reportId,
          requestId,
          beforeData: { visibleToStudent: row.visible_to_student },
          afterData: { visibleToStudent: dto.visibleToStudent },
        },
        tx,
      );
      return updated;
    });
  }

  private async resolveStudentAccess(studentId: string, actor: AuthUser): Promise<"PRIVILEGED" | "PARENT" | "STUDENT" | "TEACHER"> {
    if (actor.roles.some((role) => PRIVILEGED_ROLES.has(role))) return "PRIVILEGED";

    const result = await this.db.execute(sql`
      SELECT
        st.user_id AS student_user_id,
        st.family_id,
        pp.family_id AS parent_family_id,
        EXISTS (
          SELECT 1
          FROM student_subject_enrollments e
          LEFT JOIN teacher_assignments ta ON ta.enrollment_id = e.id AND ta.ended_at IS NULL
          WHERE e.student_id = st.id
            AND (
              ta.teacher_id = ${actor.id}
              OR EXISTS (
                SELECT 1 FROM live_sessions ls
                WHERE ls.enrollment_id = e.id AND ls.actual_teacher_id = ${actor.id}
              )
            )
        ) AS teacher_related
      FROM students st
      LEFT JOIN parent_profiles pp ON pp.user_id = ${actor.id}
      WHERE st.id = ${studentId}
      LIMIT 1
    `);
    if (!result.rowCount) throw new NotFoundException({ code: "STUDENT_NOT_FOUND", message: "Student not found" });
    const row = result.rows[0] as any;
    if (actor.roles.includes("PARENT") && row.parent_family_id === row.family_id) return "PARENT";
    if (actor.roles.includes("STUDENT") && row.student_user_id === actor.id) return "STUDENT";
    if (actor.roles.includes("TEACHER") && row.teacher_related) return "TEACHER";
    throw new ForbiddenException({ code: "REPORT_SCOPE_DENIED", message: "You cannot view reports for this student" });
  }
}
