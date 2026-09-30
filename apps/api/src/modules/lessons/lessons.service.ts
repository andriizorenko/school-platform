import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  lessonCreditAllocations,
  lessonCreditDebits,
  liveSessions,
  payrollAccruals,
  sessionCreditReservations,
  teacherRateVersions,
  teacherSubjects,
} from "@school/db";
import type { Database } from "@school/db";
import { and, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database/database.constants";
import { numberSchoolSetting } from "../../common/settings/school-settings";
import { formatInSchoolTimeZone } from "../../common/time/kyiv-time";
import type { AuthUser } from "../auth/types";
import { AuditService } from "../audit/audit.service";
import type { MarkRegularLessonDto } from "./dto/mark-regular-lesson.dto";

const PRIVILEGED_MARK_ROLES = new Set(["ADMIN", "MANAGER", "SUPPORT_MANAGER"]);
const PRIVILEGED_VIEW_ROLES = new Set(["ADMIN", "MANAGER", "SUPPORT_MANAGER"]);

@Injectable()
export class LessonsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async markRegularLesson(sessionId: string, dto: MarkRegularLessonDto, actor: AuthUser, requestId?: string) {
    const topicTitle = dto.topicTitle.trim();
    if (!topicTitle) {
      throw new ConflictException({ code: "LESSON_TOPIC_REQUIRED", message: "Lesson topic is required" });
    }

    return this.db.transaction(async (tx) => {
      const locked = await tx.execute(sql`
        SELECT
          id,
          enrollment_id,
          subject_id,
          actual_teacher_id,
          session_type,
          funding_status,
          status,
          starts_at,
          ends_at
        FROM live_sessions
        WHERE id = ${sessionId}
        FOR UPDATE
      `);
      if (!locked.rowCount) {
        throw new NotFoundException({ code: "SESSION_NOT_FOUND", message: "Lesson not found" });
      }

      const rawSession = locked.rows[0] as {
        id: string;
        enrollment_id: string | null;
        subject_id: string;
        actual_teacher_id: string;
        session_type: string;
        funding_status: string;
        status: string;
        starts_at: Date | string;
        ends_at: Date | string;
      };
      const session = {
        ...rawSession,
        starts_at: new Date(rawSession.starts_at),
        ends_at: new Date(rawSession.ends_at),
      };

      if (session.session_type !== "REGULAR" || !session.enrollment_id) {
        throw new ConflictException({
          code: "REGULAR_LESSON_REQUIRED",
          message: "This endpoint marks regular tutoring lessons only",
        });
      }
      if (session.status !== "SCHEDULED") {
        throw new ConflictException({ code: "SESSION_NOT_MARKABLE", message: "Lesson is not in a markable state" });
      }
      if (session.funding_status !== "PAID") {
        throw new ConflictException({
          code: "SESSION_NOT_PAID",
          message: "A booked slot cannot be marked as a conducted lesson until it is paid",
        });
      }

      const now = new Date();
      const teacherMarkDeadlineHours = await numberSchoolSetting(tx, "teacher_mark_deadline_hours", 48);
      const cleanStreakReset = await numberSchoolSetting(tx, "policy_clean_streak_reset", 5);
      if (now < session.starts_at) {
        throw new ConflictException({ code: "LESSON_NOT_STARTED", message: "Lesson can only be marked after it starts" });
      }

      const privileged = actor.roles.some((role) => PRIVILEGED_MARK_ROLES.has(role));
      if (!privileged) {
        if (!actor.roles.includes("TEACHER") || actor.id !== session.actual_teacher_id) {
          throw new ForbiddenException({ code: "LESSON_MARK_SCOPE_DENIED", message: "You cannot mark this lesson" });
        }
        if (now.getTime() > session.ends_at.getTime() + teacherMarkDeadlineHours * 60 * 60 * 1000) {
          throw new ForbiddenException({
            code: "LESSON_MARK_WINDOW_EXPIRED",
            message: "The teacher marking window has expired; a manager must mark this lesson",
          });
        }
      }

      const durationMinutes = Math.round((session.ends_at.getTime() - session.starts_at.getTime()) / 60_000);
      if (durationMinutes !== 30 && durationMinutes !== 60) {
        throw new ConflictException({ code: "UNSUPPORTED_LESSON_DURATION", message: "Only 30 or 60 minute regular lessons are supported" });
      }
      const creditsNeeded = durationMinutes === 30 ? 1 : 2;

      const reservationResult = await tx.execute(sql`
        SELECT id, credits_reserved, status
        FROM session_credit_reservations
        WHERE session_id = ${sessionId}
        FOR UPDATE
      `);
      if (!reservationResult.rowCount) {
        throw new ConflictException({ code: "SESSION_CREDIT_RESERVATION_MISSING", message: "Paid lesson has no credit reservation" });
      }
      const reservation = reservationResult.rows[0] as { id: string; credits_reserved: number; status: string };
      if (reservation.status !== "ACTIVE" || Number(reservation.credits_reserved) !== creditsNeeded) {
        throw new ConflictException({ code: "SESSION_CREDIT_RESERVATION_INVALID", message: "Lesson credit reservation is not active or has an invalid amount" });
      }

      const grantsResult = await tx.execute(sql`
        SELECT
          g.id,
          g.type,
          g.restricted_teacher_id,
          (
            g.credits_granted
            - COALESCE((SELECT SUM(a.credits) FROM lesson_credit_allocations a WHERE a.grant_id = g.id), 0)
          )::int AS remaining_credits
        FROM lesson_credit_grants g
        WHERE g.enrollment_id = ${session.enrollment_id}
          AND (
            g.type <> 'TEACHER_COMPENSATION'
            OR g.restricted_teacher_id IS NULL
            OR g.restricted_teacher_id = ${session.actual_teacher_id}
          )
          AND (
            g.credits_granted
            - COALESCE((SELECT SUM(a.credits) FROM lesson_credit_allocations a WHERE a.grant_id = g.id), 0)
          ) > 0
        ORDER BY
          CASE
            WHEN g.type = 'TEACHER_COMPENSATION' AND g.restricted_teacher_id = ${session.actual_teacher_id} THEN 0
            ELSE 1
          END,
          g.created_at,
          g.id
        FOR UPDATE OF g
      `);

      let remaining = creditsNeeded;
      let compensationCredits = 0;
      const allocations: Array<{ grantId: string; credits: number }> = [];
      for (const grant of grantsResult.rows as Array<{
        id: string;
        type: string;
        restricted_teacher_id: string | null;
        remaining_credits: number | string;
      }>) {
        if (remaining <= 0) break;
        const available = Number(grant.remaining_credits);
        const take = Math.min(remaining, available);
        if (take <= 0) continue;

        allocations.push({ grantId: grant.id, credits: take });
        if (grant.type === "TEACHER_COMPENSATION" && grant.restricted_teacher_id === session.actual_teacher_id) {
          compensationCredits += take;
        }
        remaining -= take;
      }

      if (remaining > 0) {
        throw new ConflictException({ code: "INSUFFICIENT_LESSON_CREDITS", message: "Not enough lesson credits to complete this lesson" });
      }

      const [debit] = await tx
        .insert(lessonCreditDebits)
        .values({
          enrollmentId: session.enrollment_id,
          type: "LESSON_COMPLETED",
          creditsDebited: creditsNeeded,
          sessionId,
          createdBy: actor.id,
        })
        .returning();

      await tx.insert(lessonCreditAllocations).values(
        allocations.map((allocation) => ({
          debitId: debit.id,
          grantId: allocation.grantId,
          credits: allocation.credits,
        })),
      );

      await tx
        .update(sessionCreditReservations)
        .set({ status: "CONSUMED", updatedAt: now })
        .where(eq(sessionCreditReservations.id, reservation.id));

      const earnedForDate = formatInSchoolTimeZone(session.starts_at).date;
      const [teacherSubject] = await tx
        .select({ id: teacherSubjects.id })
        .from(teacherSubjects)
        .where(
          and(
            eq(teacherSubjects.teacherId, session.actual_teacher_id),
            eq(teacherSubjects.subjectId, session.subject_id),
          ),
        )
        .limit(1);

      let rate60Minor: number | null = null;
      if (teacherSubject) {
        const [rate] = await tx
          .select({ rate60Minor: teacherRateVersions.rate60Minor, currency: teacherRateVersions.currency })
          .from(teacherRateVersions)
          .where(
            and(
              eq(teacherRateVersions.teacherSubjectId, teacherSubject.id),
              lte(teacherRateVersions.effectiveFrom, earnedForDate),
              or(isNull(teacherRateVersions.effectiveUntil), sql`${teacherRateVersions.effectiveUntil} >= ${earnedForDate}`),
            ),
          )
          .orderBy(desc(teacherRateVersions.effectiveFrom))
          .limit(1);
        rate60Minor = rate?.rate60Minor ?? null;
      }

      const payableCredits = creditsNeeded - compensationCredits;
      if (payableCredits > 0 && rate60Minor === null) {
        throw new ConflictException({
          code: "TEACHER_RATE_NOT_CONFIGURED",
          message: "Teacher has no active pay rate for this subject on the lesson date",
        });
      }

      const amountMinor = rate60Minor === null ? 0 : Math.round((rate60Minor * payableCredits) / 2);
      const accrualType = compensationCredits === creditsNeeded
        ? "COMPENSATION"
        : durationMinutes === 30
          ? "REGULAR_30"
          : "REGULAR_60";

      const [accrual] = await tx
        .insert(payrollAccruals)
        .values({
          teacherId: session.actual_teacher_id,
          subjectId: session.subject_id,
          sessionId,
          type: accrualType,
          earnedForDate,
          rate60SnapshotMinor: rate60Minor,
          amountMinor,
          currency: "UAH",
          compensationSourceTeacherId: compensationCredits > 0 ? session.actual_teacher_id : undefined,
          reason: compensationCredits > 0 && compensationCredits < creditsNeeded ? "Partially covered by teacher compensation credits" : undefined,
          createdBy: actor.id,
        })
        .returning();

      const [marked] = await tx
        .update(liveSessions)
        .set({
          status: "COMPLETED",
          topicTitle,
          homeworkAssigned: dto.homeworkAssigned,
          homeworkDescription: dto.homeworkAssigned ? dto.homeworkDescription?.trim() || null : null,
          markedAt: now,
          markedBy: actor.id,
          updatedAt: now,
        })
        .where(eq(liveSessions.id, sessionId))
        .returning();

      await tx.execute(sql`
        INSERT INTO student_attendance_policy_states (enrollment_id, strike_count, clean_streak, updated_at)
        VALUES (${session.enrollment_id}, 0, 0, now())
        ON CONFLICT (enrollment_id) DO UPDATE
        SET
          strike_count = CASE
            WHEN student_attendance_policy_states.strike_count = 1
              AND student_attendance_policy_states.clean_streak >= ${cleanStreakReset - 1} THEN 0
            ELSE student_attendance_policy_states.strike_count
          END,
          clean_streak = CASE
            WHEN student_attendance_policy_states.strike_count = 1
              AND student_attendance_policy_states.clean_streak >= ${cleanStreakReset - 1} THEN 0
            WHEN student_attendance_policy_states.strike_count = 1
              THEN student_attendance_policy_states.clean_streak + 1
            ELSE 0
          END,
          updated_at = now()
      `);

      await tx.execute(sql`
        INSERT INTO teacher_student_policy_states (enrollment_id, teacher_id, strike_count, clean_streak, updated_at)
        VALUES (${session.enrollment_id}, ${session.actual_teacher_id}, 0, 0, now())
        ON CONFLICT (enrollment_id, teacher_id) DO UPDATE
        SET
          strike_count = CASE
            WHEN teacher_student_policy_states.strike_count = 1
              AND teacher_student_policy_states.clean_streak >= ${cleanStreakReset - 1} THEN 0
            ELSE teacher_student_policy_states.strike_count
          END,
          clean_streak = CASE
            WHEN teacher_student_policy_states.strike_count = 1
              AND teacher_student_policy_states.clean_streak >= ${cleanStreakReset - 1} THEN 0
            WHEN teacher_student_policy_states.strike_count = 1
              THEN teacher_student_policy_states.clean_streak + 1
            ELSE 0
          END,
          updated_at = now()
      `);

      const balanceResult = await tx.execute(sql`
        SELECT
          COALESCE((SELECT SUM(credits_granted) FROM lesson_credit_grants WHERE enrollment_id = ${session.enrollment_id}), 0)::int
          - COALESCE((SELECT SUM(credits_debited) FROM lesson_credit_debits WHERE enrollment_id = ${session.enrollment_id}), 0)::int
          AS balance_credits
      `);
      const balanceCredits = Number((balanceResult.rows[0] as { balance_credits: number | string }).balance_credits);

      await this.audit.record(
        {
          actorUserId: actor.id,
          actorRoleCode: actor.roles[0],
          action: "MARK_REGULAR_LESSON_COMPLETED",
          entityType: "LiveSession",
          entityId: sessionId,
          requestId,
          beforeData: { status: session.status, fundingStatus: session.funding_status },
          afterData: {
            status: "COMPLETED",
            topicTitle,
            homeworkAssigned: dto.homeworkAssigned,
            homeworkDescription: dto.homeworkAssigned ? dto.homeworkDescription?.trim() || null : null,
            creditsDebited: creditsNeeded,
            compensationCredits,
            payrollAccrualMinor: amountMinor,
            balanceCredits,
          },
        },
        tx,
      );

      return {
        session: marked,
        balance: { credits: balanceCredits, lessonUnits: balanceCredits / 2 },
        payrollAccrual: accrual,
      };
    });
  }

  async getEnrollmentJournal(enrollmentId: string, actor: AuthUser) {
    const scope = await this.resolveJournalScope(enrollmentId, actor);

    const rowsResult = await this.db.execute(sql`
      SELECT
        s.id,
        s.starts_at,
        s.ends_at,
        s.topic_title,
        s.homework_assigned,
        s.homework_description,
        s.primary_teacher_id,
        s.actual_teacher_id,
        t.first_name AS actual_teacher_first_name,
        t.last_name AS actual_teacher_last_name
      FROM live_sessions s
      JOIN teacher_profiles t ON t.user_id = s.actual_teacher_id
      WHERE s.enrollment_id = ${enrollmentId}
        AND s.status = 'COMPLETED'
        ${scope.teacherOwnOnly ? sql`AND s.actual_teacher_id = ${actor.id}` : sql``}
      ORDER BY s.starts_at ASC
    `);

    return rowsResult.rows.map((row: any, index: number) => ({
      lessonNumber: index + 1,
      id: row.id,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      topicTitle: row.topic_title,
      homeworkAssigned: row.homework_assigned,
      homeworkDescription: row.homework_description,
      actualTeacher: {
        id: row.actual_teacher_id,
        firstName: row.actual_teacher_first_name,
        lastName: row.actual_teacher_last_name,
      },
      actualTeacherFullName: `${row.actual_teacher_last_name} ${row.actual_teacher_first_name}`,
      isSubstitute: row.actual_teacher_id !== row.primary_teacher_id,
    }));
  }

  private async resolveJournalScope(enrollmentId: string, actor: AuthUser) {
    if (actor.roles.some((role) => PRIVILEGED_VIEW_ROLES.has(role))) return { teacherOwnOnly: false };

    const result = await this.db.execute(sql`
      SELECT
        st.user_id AS student_user_id,
        pp.user_id AS parent_user_id,
        ta.teacher_id AS primary_teacher_id,
        EXISTS (
          SELECT 1 FROM live_sessions ls
          WHERE ls.enrollment_id = e.id AND ls.actual_teacher_id = ${actor.id}
        ) AS has_taught
      FROM student_subject_enrollments e
      JOIN students st ON st.id = e.student_id
      LEFT JOIN parent_profiles pp ON pp.family_id = st.family_id
      LEFT JOIN teacher_assignments ta ON ta.enrollment_id = e.id AND ta.ended_at IS NULL
      WHERE e.id = ${enrollmentId}
      LIMIT 1
    `);
    if (!result.rowCount) throw new NotFoundException({ code: "ENROLLMENT_NOT_FOUND", message: "Enrollment not found" });

    const row = result.rows[0] as {
      student_user_id: string | null;
      parent_user_id: string | null;
      primary_teacher_id: string | null;
      has_taught: boolean;
    };

    if (row.student_user_id === actor.id || row.parent_user_id === actor.id || row.primary_teacher_id === actor.id) {
      return { teacherOwnOnly: false };
    }
    if (actor.roles.includes("TEACHER") && row.has_taught) return { teacherOwnOnly: true };

    throw new ForbiddenException({ code: "JOURNAL_SCOPE_DENIED", message: "You cannot view this journal" });
  }
}
