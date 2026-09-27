import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  lessonCreditAllocations,
  lessonCreditDebits,
  lessonCreditGrants,
  liveSessions,
  payrollAccruals,
  progressReports,
  sessionCreditReservations,
  sessionIncidents,
  studentAttendancePolicyStates,
  teacherRateVersions,
  teacherStudentPolicyStates,
  teacherSubjects,
} from "@school/db";
import type { Database } from "@school/db";
import { and, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database/database.constants";
import { numberSchoolSetting } from "../../common/settings/school-settings";
import { formatInSchoolTimeZone } from "../../common/time/kyiv-time";
import type { AuthUser } from "../auth/types";
import { AuditService } from "../audit/audit.service";
import { OutboxService } from "../audit/outbox.service";
import { FundingMaterializerService } from "../scheduling/funding-materializer.service";
import type { CompleteFirstLessonDto } from "./dto/complete-first-lesson.dto";
import type { ReportLessonIncidentDto } from "./dto/report-lesson-incident.dto";
import type { UndoLessonOutcomeDto } from "./dto/undo-lesson-outcome.dto";

const PRIVILEGED_ROLES = new Set(["ADMIN", "MANAGER", "SUPPORT_MANAGER"]);

type LockedSession = {
  id: string;
  student_id: string;
  enrollment_id: string | null;
  subject_id: string;
  actual_teacher_id: string;
  session_type: string;
  funding_status: string;
  status: string;
  starts_at: Date;
  ends_at: Date;
};

@Injectable()
export class LessonPoliciesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly fundingMaterializer: FundingMaterializerService,
  ) {}

  async reportStudentNoShow(sessionId: string, dto: ReportLessonIncidentDto, actor: AuthUser, requestId?: string) {
    return this.db.transaction(async (tx) => {
      const session = await this.lockSession(tx, sessionId);
      this.assertRegularPaidSession(session);
      this.assertIncidentActor(session, actor);
      await this.assertNoIncidentForCurrentOccurrence(tx, sessionId);

      const now = Date.now();
      const lateNoticeCutoffMinutes = await numberSchoolSetting(tx, "lesson_late_notice_cutoff_minutes", 120);
      const lateWindowStartsAt = session.starts_at.getTime() - lateNoticeCutoffMinutes * 60 * 1000;
      if (now < lateWindowStartsAt) {
        throw new ConflictException({
          code: "STUDENT_LATE_NOTICE_WINDOW_NOT_OPEN",
          message: `This is still an advance notice. Late/no-notice policy starts ${lateNoticeCutoffMinutes} minutes before lesson start`,
        });
      }

      if (!actor.roles.some((role) => PRIVILEGED_ROLES.has(role)) && now >= session.starts_at.getTime()) {
        const noShowWaitMinutes = await numberSchoolSetting(tx, "student_no_show_wait_minutes", 15);
        if (now < session.starts_at.getTime() + noShowWaitMinutes * 60 * 1000) {
          throw new ConflictException({
            code: "NO_SHOW_WAIT_PERIOD_ACTIVE",
            message: `Teacher must wait ${noShowWaitMinutes} minutes after lesson start before recording a student no-show`,
          });
        }
      }

      const stateResult = await tx.execute(sql`
        SELECT strike_count, clean_streak
        FROM student_attendance_policy_states
        WHERE enrollment_id = ${session.enrollment_id!}
        FOR UPDATE
      `);
      const currentStrike = stateResult.rowCount
        ? Number((stateResult.rows[0] as { strike_count: number }).strike_count)
        : 0;

      if (currentStrike === 0) {
        if (!stateResult.rowCount) {
          await tx.insert(studentAttendancePolicyStates).values({
            enrollmentId: session.enrollment_id!,
            strikeCount: 1,
            cleanStreak: 0,
          });
        } else {
          await tx
            .update(studentAttendancePolicyStates)
            .set({ strikeCount: 1, cleanStreak: 0, updatedAt: new Date() })
            .where(eq(studentAttendancePolicyStates.enrollmentId, session.enrollment_id!));
        }

        const [incident] = await tx
          .insert(sessionIncidents)
          .values({
            sessionId,
            type: "STUDENT_NO_SHOW",
            responsibleStudentId: session.student_id,
            policyStrikeNumber: 1,
            outcome: "RESCHEDULE_REQUIRED_NO_CHARGE",
            comment: dto.comment?.trim() || undefined,
            createdBy: actor.id,
          })
          .returning();

        await this.audit.record(
          {
            actorUserId: actor.id,
            actorRoleCode: actor.roles[0],
            action: "RECORD_STUDENT_NO_SHOW_FIRST_STRIKE",
            entityType: "LiveSession",
            entityId: sessionId,
            requestId,
            afterData: {
              strike: 1,
              charged: false,
              teacherPaid: false,
              requiresReschedule: true,
              comment: dto.comment,
            },
          },
          tx,
        );

        return {
          incident,
          strike: 1,
          charged: false,
          teacherPaid: false,
          requiresReschedule: true,
        };
      }

      const creditsNeeded = this.sessionCredits(session);
      const reservation = await this.lockActiveReservation(tx, sessionId, creditsNeeded);
      const allocations = await this.allocateCredits(tx, session.enrollment_id!, creditsNeeded);

      const [debit] = await tx
        .insert(lessonCreditDebits)
        .values({
          enrollmentId: session.enrollment_id!,
          type: "NO_SHOW_CHARGED",
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
        .set({ status: "CONSUMED", updatedAt: new Date() })
        .where(eq(sessionCreditReservations.id, reservation.id));

      const rate60Minor = await this.getTeacherRate60Minor(tx, session.actual_teacher_id, session.subject_id, session.starts_at);
      if (rate60Minor === null) {
        throw new ConflictException({
          code: "TEACHER_RATE_NOT_CONFIGURED",
          message: "Teacher has no active pay rate for this subject on the lesson date",
        });
      }
      const amountMinor = Math.round((rate60Minor * creditsNeeded) / 2);
      const earnedForDate = formatInSchoolTimeZone(session.starts_at).date;
      const [accrual] = await tx
        .insert(payrollAccruals)
        .values({
          teacherId: session.actual_teacher_id,
          subjectId: session.subject_id,
          sessionId,
          type: "PAID_STUDENT_NO_SHOW",
          earnedForDate,
          rate60SnapshotMinor: rate60Minor,
          amountMinor,
          currency: "UAH",
          reason: "Second student no-show before clean-streak reset",
          createdBy: actor.id,
        })
        .returning();

      await tx
        .update(liveSessions)
        .set({ status: "CHARGED_NO_SHOW", markedAt: new Date(), markedBy: actor.id, updatedAt: new Date() })
        .where(eq(liveSessions.id, sessionId));

      await tx
        .update(studentAttendancePolicyStates)
        .set({ strikeCount: 0, cleanStreak: 0, updatedAt: new Date() })
        .where(eq(studentAttendancePolicyStates.enrollmentId, session.enrollment_id!));

      const [incident] = await tx
        .insert(sessionIncidents)
        .values({
          sessionId,
          type: "STUDENT_NO_SHOW",
          responsibleStudentId: session.student_id,
          policyStrikeNumber: 2,
          outcome: "CHARGED_NO_SHOW",
          comment: dto.comment?.trim() || undefined,
          createdBy: actor.id,
        })
        .returning();

      const fundingPlan = await this.fundingMaterializer.refreshEnrollment(session.enrollment_id!, actor.id, tx);

      await this.audit.record(
        {
          actorUserId: actor.id,
          actorRoleCode: actor.roles[0],
          action: "RECORD_STUDENT_NO_SHOW_SECOND_STRIKE",
          entityType: "LiveSession",
          entityId: sessionId,
          requestId,
          beforeData: { status: session.status, strike: 1 },
          afterData: {
            status: "CHARGED_NO_SHOW",
            strike: 0,
            creditsDebited: creditsNeeded,
            payrollAccrualMinor: amountMinor,
            comment: dto.comment,
          },
        },
        tx,
      );

      return {
        incident,
        strike: 0,
        charged: true,
        creditsDebited: creditsNeeded,
        payrollAccrual: accrual,
        fundingPlan,
      };
    });
  }

  async reportTeacherLateCancellation(
    sessionId: string,
    dto: ReportLessonIncidentDto,
    actor: AuthUser,
    requestId?: string,
  ) {
    return this.db.transaction(async (tx) => {
      const session = await this.lockSession(tx, sessionId);
      this.assertRegularPaidSession(session);
      this.assertIncidentActor(session, actor);
      await this.assertNoIncidentForCurrentOccurrence(tx, sessionId);

      const now = Date.now();
      const lateNoticeCutoffMinutes = await numberSchoolSetting(tx, "lesson_late_notice_cutoff_minutes", 120);
      if (now < session.starts_at.getTime() - lateNoticeCutoffMinutes * 60 * 1000) {
        throw new ConflictException({
          code: "TEACHER_LATE_CANCELLATION_WINDOW_NOT_OPEN",
          message: `This is still an advance notice. Late-cancellation policy starts ${lateNoticeCutoffMinutes} minutes before lesson start`,
        });
      }

      if (!actor.roles.some((role) => PRIVILEGED_ROLES.has(role))) {
        const teacherMarkDeadlineHours = await numberSchoolSetting(tx, "teacher_mark_deadline_hours", 48);
        if (now > session.ends_at.getTime() + teacherMarkDeadlineHours * 60 * 60 * 1000) {
          throw new ForbiddenException({
            code: "TEACHER_LATE_CANCELLATION_WINDOW_EXPIRED",
            message: "The late-cancellation window for this lesson has expired",
          });
        }
      }

      const stateResult = await tx.execute(sql`
        SELECT strike_count, clean_streak
        FROM teacher_student_policy_states
        WHERE enrollment_id = ${session.enrollment_id!}
          AND teacher_id = ${session.actual_teacher_id}
        FOR UPDATE
      `);
      const currentStrike = stateResult.rowCount
        ? Number((stateResult.rows[0] as { strike_count: number }).strike_count)
        : 0;

      if (currentStrike === 0) {
        if (!stateResult.rowCount) {
          await tx.insert(teacherStudentPolicyStates).values({
            enrollmentId: session.enrollment_id!,
            teacherId: session.actual_teacher_id,
            strikeCount: 1,
            cleanStreak: 0,
          });
        } else {
          await tx
            .update(teacherStudentPolicyStates)
            .set({ strikeCount: 1, cleanStreak: 0, updatedAt: new Date() })
            .where(
              and(
                eq(teacherStudentPolicyStates.enrollmentId, session.enrollment_id!),
                eq(teacherStudentPolicyStates.teacherId, session.actual_teacher_id),
              ),
            );
        }

        const [incident] = await tx
          .insert(sessionIncidents)
          .values({
            sessionId,
            type: "TEACHER_LATE_CANCELLATION",
            responsibleUserId: session.actual_teacher_id,
            responsibleTeacherId: session.actual_teacher_id,
            policyStrikeNumber: 1,
            outcome: "RESCHEDULE_REQUIRED_NO_CHARGE",
            comment: dto.comment?.trim() || undefined,
            createdBy: actor.id,
          })
          .returning();

        await this.audit.record(
          {
            actorUserId: actor.id,
            actorRoleCode: actor.roles[0],
            action: "RECORD_TEACHER_LATE_CANCELLATION_FIRST_STRIKE",
            entityType: "LiveSession",
            entityId: sessionId,
            requestId,
            afterData: { strike: 1, charged: false, teacherPaid: false, requiresReschedule: true, comment: dto.comment },
          },
          tx,
        );

        return { incident, strike: 1, compensationGranted: false, requiresReschedule: true };
      }

      const creditsGranted = this.sessionCredits(session);
      const [compensationGrant] = await tx
        .insert(lessonCreditGrants)
        .values({
          enrollmentId: session.enrollment_id!,
          type: "TEACHER_COMPENSATION",
          creditsGranted,
          restrictedTeacherId: session.actual_teacher_id,
          createdBy: actor.id,
        })
        .returning();

      await tx
        .update(teacherStudentPolicyStates)
        .set({ strikeCount: 0, cleanStreak: 0, updatedAt: new Date() })
        .where(
          and(
            eq(teacherStudentPolicyStates.enrollmentId, session.enrollment_id!),
            eq(teacherStudentPolicyStates.teacherId, session.actual_teacher_id),
          ),
        );

      const [incident] = await tx
        .insert(sessionIncidents)
        .values({
          sessionId,
          type: "TEACHER_LATE_CANCELLATION",
          responsibleUserId: session.actual_teacher_id,
          responsibleTeacherId: session.actual_teacher_id,
          policyStrikeNumber: 2,
          outcome: "COMPENSATION_GRANTED",
          comment: dto.comment?.trim() || undefined,
          createdBy: actor.id,
        })
        .returning();

      const fundingPlan = await this.fundingMaterializer.refreshEnrollment(session.enrollment_id!, actor.id, tx);

      await this.audit.record(
        {
          actorUserId: actor.id,
          actorRoleCode: actor.roles[0],
          action: "RECORD_TEACHER_LATE_CANCELLATION_SECOND_STRIKE",
          entityType: "LiveSession",
          entityId: sessionId,
          requestId,
          beforeData: { strike: 1 },
          afterData: {
            strike: 0,
            compensationCredits: creditsGranted,
            compensationLessonUnits: creditsGranted / 2,
            restrictedTeacherId: session.actual_teacher_id,
            requiresReschedule: true,
            comment: dto.comment,
          },
        },
        tx,
      );

      return {
        incident,
        strike: 0,
        compensationGranted: true,
        compensationGrant,
        fundingPlan,
        requiresReschedule: true,
      };
    });
  }

  async undoLessonOutcome(
    sessionId: string,
    dto: UndoLessonOutcomeDto,
    actor: AuthUser,
    requestId?: string,
  ) {
    const reason = dto.reason.trim();
    if (!reason) {
      throw new ConflictException({ code: "LESSON_OUTCOME_UNDO_REASON_REQUIRED", message: "Correction reason is required" });
    }

    return this.db.transaction(async (tx) => {
      const session = await this.lockSession(tx, sessionId);
      const privileged = actor.roles.some((role) => PRIVILEGED_ROLES.has(role));
      if (!privileged) {
        const teacherMarkDeadlineHours = await numberSchoolSetting(tx, "teacher_mark_deadline_hours", 48);
        const teacherDeadline = session.ends_at.getTime() + teacherMarkDeadlineHours * 60 * 60 * 1000;
        if (!actor.roles.includes("TEACHER") || actor.id !== session.actual_teacher_id || Date.now() > teacherDeadline) {
          throw new ForbiddenException({
            code: "LESSON_OUTCOME_UNDO_SCOPE_DENIED",
            message: "You cannot undo this lesson outcome",
          });
        }
      }

      const incidentResult = await tx.execute(sql`
        SELECT i.id, i.type, i.outcome, i.policy_strike_number, i.created_at
        FROM session_incidents i
        WHERE i.session_id = ${sessionId}
          AND i.created_at > COALESCE(
            (SELECT MAX(r.created_at) FROM session_reschedules r WHERE r.session_id = ${sessionId}),
            '-infinity'::timestamptz
          )
        ORDER BY i.created_at DESC
        LIMIT 1
        FOR UPDATE
      `);
      const incident = incidentResult.rows[0] as {
        id: string;
        type: "STUDENT_NO_SHOW" | "TEACHER_LATE_CANCELLATION";
        outcome: "RESCHEDULE_REQUIRED_NO_CHARGE" | "CHARGED_NO_SHOW" | "COMPENSATION_GRANTED" | null;
        policy_strike_number: number;
        created_at: Date;
      } | undefined;

      const hasRecordedOutcome =
        session.status === "COMPLETED" ||
        session.status === "CHARGED_NO_SHOW" ||
        Boolean(incident);
      if (!hasRecordedOutcome) {
        throw new ConflictException({
          code: "LESSON_OUTCOME_NOTHING_TO_UNDO",
          message: "This lesson has no recorded outcome to undo",
        });
      }

      if (session.status === "COMPLETED" && session.session_type === "REGULAR") {
        const completedReport = await tx.execute(sql`
          SELECT rr.id
          FROM progress_report_requests rr
          WHERE rr.target_session_id=${sessionId}
            AND rr.status='COMPLETED'
          LIMIT 1
        `);
        if (completedReport.rowCount) {
          throw new ConflictException({
            code: "LESSON_OUTCOME_HAS_COMPLETED_REPORT",
            message: "The requested progress report for this lesson is already completed",
          });
        }
      }

      const accrualResult = await tx.execute(sql`
        SELECT
          pa.id,
          EXISTS(SELECT 1 FROM payroll_accrual_settlements pas WHERE pas.accrual_id=pa.id) AS settled,
          EXISTS(SELECT 1 FROM teacher_payout_items tpi WHERE tpi.accrual_id=pa.id) AS in_payout
        FROM payroll_accruals pa
        WHERE pa.session_id=${sessionId}
        LIMIT 1
        FOR UPDATE
      `);
      const accrual = accrualResult.rows[0] as { id: string; settled: boolean; in_payout: boolean } | undefined;
      if (accrual?.settled || accrual?.in_payout) {
        throw new ConflictException({
          code: "LESSON_OUTCOME_PAYROLL_SETTLED",
          message: "This lesson is already included in payroll and cannot be undone",
        });
      }

      let compensationGrantId: string | null = null;
      if (incident?.outcome === "COMPENSATION_GRANTED" && session.enrollment_id) {
        const grantResult = await tx.execute(sql`
          SELECT g.id
          FROM lesson_credit_grants g
          WHERE g.enrollment_id=${session.enrollment_id}
            AND g.type='TEACHER_COMPENSATION'
            AND g.restricted_teacher_id=${session.actual_teacher_id}
            AND g.created_at BETWEEN ${incident.created_at} - interval '10 seconds'
                                 AND ${incident.created_at} + interval '10 seconds'
          ORDER BY ABS(EXTRACT(EPOCH FROM (g.created_at - ${incident.created_at}))) ASC
          LIMIT 1
          FOR UPDATE
        `);
        compensationGrantId = (grantResult.rows[0] as { id: string } | undefined)?.id ?? null;
        if (!compensationGrantId) {
          throw new ConflictException({
            code: "LESSON_OUTCOME_COMPENSATION_NOT_REVERSIBLE",
            message: "The compensation credit linked to this incident could not be identified safely",
          });
        }

        const used = await tx.execute(sql`
          SELECT 1 FROM lesson_credit_allocations WHERE grant_id=${compensationGrantId} LIMIT 1
        `);
        if (used.rowCount) {
          throw new ConflictException({
            code: "LESSON_OUTCOME_COMPENSATION_ALREADY_USED",
            message: "The compensation credit has already been used and this incident cannot be undone",
          });
        }
      }

      const debitResult = await tx.execute(sql`
        SELECT id, type, credits_debited
        FROM lesson_credit_debits
        WHERE session_id=${sessionId}
          AND type IN ('LESSON_COMPLETED','NO_SHOW_CHARGED')
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE
      `);
      const debit = debitResult.rows[0] as { id: string; type: string; credits_debited: number } | undefined;

      const snapshot = JSON.stringify({
        status: session.status,
        sessionType: session.session_type,
        fundingStatus: session.funding_status,
        incident: incident ? {
          id: incident.id,
          type: incident.type,
          outcome: incident.outcome,
          policyStrikeNumber: incident.policy_strike_number,
        } : null,
        debit: debit ? { id: debit.id, type: debit.type, creditsDebited: Number(debit.credits_debited) } : null,
        payrollAccrualId: accrual?.id ?? null,
        compensationGrantId,
      });

      await tx.execute(sql`
        INSERT INTO lesson_outcome_corrections (
          session_id, previous_status, incident_id, incident_type, incident_outcome,
          reason, before_data, corrected_by
        )
        VALUES (
          ${sessionId},
          ${session.status}::live_session_status,
          ${incident?.id ?? null},
          ${incident?.type ?? null}::session_incident_type,
          ${incident?.outcome ?? null}::session_incident_outcome,
          ${reason},
          ${snapshot}::jsonb,
          ${actor.id}
        )
      `);

      if (debit) {
        await tx.execute(sql`DELETE FROM lesson_credit_allocations WHERE debit_id=${debit.id}`);
        await tx.execute(sql`DELETE FROM lesson_credit_debits WHERE id=${debit.id}`);
      }

      if (accrual) {
        await tx.execute(sql`DELETE FROM payroll_accruals WHERE id=${accrual.id}`);
      }

      if (session.session_type === "FIRST" && session.status === "COMPLETED") {
        await tx.execute(sql`
          DELETE FROM progress_reports
          WHERE session_id=${sessionId}
            AND report_type='INITIAL'
        `);
      }

      if (compensationGrantId) {
        await tx.execute(sql`DELETE FROM lesson_credit_grants WHERE id=${compensationGrantId}`);
      }

      if (incident) {
        await tx.execute(sql`DELETE FROM session_incidents WHERE id=${incident.id}`);
      }

      if (session.status === "COMPLETED" || session.status === "CHARGED_NO_SHOW") {
        await tx.execute(sql`
          UPDATE live_sessions
          SET
            status='SCHEDULED',
            topic_title=NULL,
            homework_assigned=NULL,
            marked_at=NULL,
            marked_by=NULL,
            updated_at=now()
          WHERE id=${sessionId}
        `);
      }

      if (session.enrollment_id && (debit || session.status === "CHARGED_NO_SHOW" || session.status === "COMPLETED")) {
        await tx.execute(sql`
          UPDATE session_credit_reservations
          SET status='ACTIVE', updated_at=now()
          WHERE session_id=${sessionId}
            AND status='CONSUMED'
        `);
      }

      if (session.enrollment_id) {
        await this.rebuildStudentAttendancePolicy(tx, session.enrollment_id);
        await this.rebuildTeacherAttendancePolicy(tx, session.enrollment_id, session.actual_teacher_id);
      }

      const fundingPlan = session.enrollment_id
        ? await this.fundingMaterializer.refreshEnrollment(session.enrollment_id, actor.id, tx)
        : null;

      await this.audit.record(
        {
          actorUserId: actor.id,
          actorRoleCode: actor.roles[0],
          action: "UNDO_LESSON_OUTCOME",
          entityType: "LiveSession",
          entityId: sessionId,
          requestId,
          beforeData: JSON.parse(snapshot),
          afterData: {
            status: "SCHEDULED",
            reason,
            restoredReservation: Boolean(session.enrollment_id),
            fundingPlan,
          },
        },
        tx,
      );

      return {
        ok: true,
        sessionId,
        status: "SCHEDULED",
        reason,
        fundingPlan,
      };
    });
  }

  private async rebuildStudentAttendancePolicy(tx: any, enrollmentId: string) {
    const cleanStreakReset = await numberSchoolSetting(tx, "policy_clean_streak_reset", 5);
    const events = await tx.execute(sql`
      SELECT event_type, event_at, strike_number
      FROM (
        SELECT 'COMPLETED'::text AS event_type, COALESCE(marked_at, updated_at) AS event_at, NULL::int AS strike_number
        FROM live_sessions
        WHERE enrollment_id=${enrollmentId}
          AND session_type='REGULAR'
          AND status='COMPLETED'

        UNION ALL

        SELECT 'STUDENT_NO_SHOW'::text AS event_type, i.created_at AS event_at, i.policy_strike_number::int AS strike_number
        FROM session_incidents i
        JOIN live_sessions s ON s.id=i.session_id
        WHERE s.enrollment_id=${enrollmentId}
          AND i.type='STUDENT_NO_SHOW'
      ) history
      ORDER BY event_at ASC, event_type ASC
    `);

    let strike = 0;
    let clean = 0;
    for (const row of events.rows as Array<{ event_type: string; strike_number: number | null }>) {
      if (row.event_type === "STUDENT_NO_SHOW") {
        if (Number(row.strike_number) === 1) {
          strike = 1;
          clean = 0;
        } else {
          strike = 0;
          clean = 0;
        }
        continue;
      }
      if (strike === 1) {
        if (clean >= cleanStreakReset - 1) {
          strike = 0;
          clean = 0;
        } else {
          clean += 1;
        }
      } else {
        clean = 0;
      }
    }

    await tx.execute(sql`
      INSERT INTO student_attendance_policy_states (enrollment_id, strike_count, clean_streak, updated_at)
      VALUES (${enrollmentId}, ${strike}, ${clean}, now())
      ON CONFLICT (enrollment_id) DO UPDATE
      SET strike_count=EXCLUDED.strike_count, clean_streak=EXCLUDED.clean_streak, updated_at=now()
    `);
  }

  private async rebuildTeacherAttendancePolicy(tx: any, enrollmentId: string, teacherId: string) {
    const cleanStreakReset = await numberSchoolSetting(tx, "policy_clean_streak_reset", 5);
    const events = await tx.execute(sql`
      SELECT event_type, event_at, strike_number
      FROM (
        SELECT 'COMPLETED'::text AS event_type, COALESCE(marked_at, updated_at) AS event_at, NULL::int AS strike_number
        FROM live_sessions
        WHERE enrollment_id=${enrollmentId}
          AND actual_teacher_id=${teacherId}
          AND session_type='REGULAR'
          AND status='COMPLETED'

        UNION ALL

        SELECT 'TEACHER_LATE_CANCELLATION'::text AS event_type, i.created_at AS event_at, i.policy_strike_number::int AS strike_number
        FROM session_incidents i
        JOIN live_sessions s ON s.id=i.session_id
        WHERE s.enrollment_id=${enrollmentId}
          AND i.type='TEACHER_LATE_CANCELLATION'
          AND i.responsible_teacher_id=${teacherId}
      ) history
      ORDER BY event_at ASC, event_type ASC
    `);

    let strike = 0;
    let clean = 0;
    for (const row of events.rows as Array<{ event_type: string; strike_number: number | null }>) {
      if (row.event_type === "TEACHER_LATE_CANCELLATION") {
        if (Number(row.strike_number) === 1) {
          strike = 1;
          clean = 0;
        } else {
          strike = 0;
          clean = 0;
        }
        continue;
      }
      if (strike === 1) {
        if (clean >= cleanStreakReset - 1) {
          strike = 0;
          clean = 0;
        } else {
          clean += 1;
        }
      } else {
        clean = 0;
      }
    }

    await tx.execute(sql`
      INSERT INTO teacher_student_policy_states (enrollment_id, teacher_id, strike_count, clean_streak, updated_at)
      VALUES (${enrollmentId}, ${teacherId}, ${strike}, ${clean}, now())
      ON CONFLICT (enrollment_id, teacher_id) DO UPDATE
      SET strike_count=EXCLUDED.strike_count, clean_streak=EXCLUDED.clean_streak, updated_at=now()
    `);
  }

  async completeFirstLesson(sessionId: string, dto: CompleteFirstLessonDto, actor: AuthUser, requestId?: string) {
    const strengths = dto.strengths.trim();
    const gaps = dto.gaps.trim();
    const actionPlan = dto.actionPlan.trim();
    if (!strengths || !gaps || !actionPlan) {
      throw new ConflictException({
        code: "INITIAL_REPORT_REQUIRED",
        message: "Strengths, gaps and action plan are required to complete a first lesson",
      });
    }

    return this.db.transaction(async (tx) => {
      const session = await this.lockSession(tx, sessionId);
      if (session.session_type !== "FIRST") {
        throw new ConflictException({ code: "FIRST_LESSON_REQUIRED", message: "This endpoint completes first lessons only" });
      }
      if (session.status !== "SCHEDULED") {
        throw new ConflictException({ code: "SESSION_NOT_MARKABLE", message: "First lesson is not in a markable state" });
      }
      if (session.funding_status !== "PAID") {
        throw new ConflictException({
          code: "FIRST_LESSON_NOT_PAID",
          message: "First lesson must be financially covered before it can be completed",
        });
      }

      const now = new Date();
      const teacherMarkDeadlineHours = await numberSchoolSetting(tx, "teacher_mark_deadline_hours", 48);
      const firstLessonTeacherPayMinor = await numberSchoolSetting(tx, "first_lesson_teacher_pay_minor", 15_000);
      if (now < session.starts_at) {
        throw new ConflictException({ code: "LESSON_NOT_STARTED", message: "First lesson can only be completed after it starts" });
      }
      const privileged = actor.roles.some((role) => PRIVILEGED_ROLES.has(role));
      if (!privileged) {
        if (!actor.roles.includes("TEACHER") || actor.id !== session.actual_teacher_id) {
          throw new ForbiddenException({ code: "LESSON_MARK_SCOPE_DENIED", message: "You cannot complete this first lesson" });
        }
        if (now.getTime() > session.ends_at.getTime() + teacherMarkDeadlineHours * 60 * 60 * 1000) {
          throw new ForbiddenException({
            code: "LESSON_MARK_WINDOW_EXPIRED",
            message: "The teacher marking window has expired; a manager must complete this first lesson",
          });
        }
      }

      const [report] = await tx
        .insert(progressReports)
        .values({
          studentId: session.student_id,
          subjectId: session.subject_id,
          sessionId,
          reportType: "INITIAL",
          strengths,
          gaps,
          actionPlan,
          visibleToParent: true,
          visibleToStudent: dto.visibleToStudent ?? true,
          createdByTeacherId: session.actual_teacher_id,
        })
        .returning();

      const earnedForDate = formatInSchoolTimeZone(session.starts_at).date;
      const [accrual] = await tx
        .insert(payrollAccruals)
        .values({
          teacherId: session.actual_teacher_id,
          subjectId: session.subject_id,
          sessionId,
          type: "FIRST_LESSON",
          earnedForDate,
          amountMinor: firstLessonTeacherPayMinor,
          currency: "UAH",
          reason: "First lesson fixed teacher pay",
          createdBy: actor.id,
        })
        .returning();

      const [completed] = await tx
        .update(liveSessions)
        .set({ status: "COMPLETED", markedAt: now, markedBy: actor.id, updatedAt: now })
        .where(eq(liveSessions.id, sessionId))
        .returning();

      await this.audit.record(
        {
          actorUserId: actor.id,
          actorRoleCode: actor.roles[0],
          action: "COMPLETE_FIRST_LESSON_WITH_INITIAL_REPORT",
          entityType: "LiveSession",
          entityId: sessionId,
          requestId,
          beforeData: { status: session.status, fundingStatus: session.funding_status },
          afterData: {
            status: "COMPLETED",
            reportId: report.id,
            visibleToStudent: report.visibleToStudent,
            payrollAccrualMinor: firstLessonTeacherPayMinor,
          },
        },
        tx,
      );

      const audienceResult = await tx.execute(sql`
        SELECT st.user_id AS student_user_id, st.first_name, st.last_name, pp.user_id AS parent_user_id, sub.name AS subject_name
        FROM students st
        JOIN subjects sub ON sub.id = ${session.subject_id}
        LEFT JOIN parent_profiles pp ON pp.family_id = st.family_id
        WHERE st.id = ${session.student_id}
        LIMIT 1
      `);
      if (audienceResult.rowCount) {
        const audience = audienceResult.rows[0] as any;
        const recipients: string[] = [];
        if (audience.parent_user_id) recipients.push(audience.parent_user_id);
        if (report.visibleToStudent && audience.student_user_id) recipients.push(audience.student_user_id);
        await this.outbox.publishNotification(
          {
            aggregateType: "ProgressReport",
            aggregateId: report.id,
            recipientUserIds: recipients,
            eventType: "REPORT_READY",
            title: "Звіт після першого заняття готовий",
            body: `${audience.first_name} ${audience.last_name} · ${audience.subject_name}`,
            actionPath: audience.parent_user_id ? `/parent/students/${session.student_id}/reports` : "/student/reports",
            entityType: "ProgressReport",
            entityId: report.id,
            data: { studentId: session.student_id, subjectId: session.subject_id, reportType: "INITIAL" },
          },
          tx,
        );
      }

      return { session: completed, report, payrollAccrual: accrual };
    });
  }

  private async lockSession(tx: any, sessionId: string): Promise<LockedSession> {
    const locked = await tx.execute(sql`
      SELECT id, student_id, enrollment_id, subject_id, actual_teacher_id, session_type, funding_status, status, starts_at, ends_at
      FROM live_sessions
      WHERE id = ${sessionId}
      FOR UPDATE
    `);
    if (!locked.rowCount) throw new NotFoundException({ code: "SESSION_NOT_FOUND", message: "Lesson not found" });
    const row = locked.rows[0] as Omit<LockedSession, "starts_at" | "ends_at"> & {
      starts_at: Date | string;
      ends_at: Date | string;
    };
    return {
      ...row,
      starts_at: new Date(row.starts_at),
      ends_at: new Date(row.ends_at),
    };
  }

  private assertRegularPaidSession(session: LockedSession) {
    if (session.session_type !== "REGULAR" || !session.enrollment_id) {
      throw new ConflictException({ code: "REGULAR_LESSON_REQUIRED", message: "Incident policy applies to regular lessons only" });
    }
    if (session.status !== "SCHEDULED") {
      throw new ConflictException({ code: "SESSION_NOT_SCHEDULED", message: "Incident can only be recorded for a scheduled lesson" });
    }
    if (session.funding_status !== "PAID") {
      throw new ConflictException({ code: "SESSION_NOT_PAID", message: "Incident policy does not apply to an unpaid booked slot" });
    }
  }

  private assertIncidentActor(session: LockedSession, actor: AuthUser) {
    if (actor.roles.some((role) => PRIVILEGED_ROLES.has(role))) return;
    if (actor.roles.includes("TEACHER") && actor.id === session.actual_teacher_id) return;
    throw new ForbiddenException({ code: "LESSON_INCIDENT_SCOPE_DENIED", message: "You cannot record an incident for this lesson" });
  }

  private async assertNoIncidentForCurrentOccurrence(tx: any, sessionId: string) {
    const result = await tx.execute(sql`
      SELECT EXISTS (
        SELECT 1
        FROM session_incidents i
        WHERE i.session_id = ${sessionId}
          AND i.created_at > COALESCE(
            (SELECT MAX(r.created_at) FROM session_reschedules r WHERE r.session_id = ${sessionId}),
            '-infinity'::timestamptz
          )
      ) AS already_recorded
    `);
    if ((result.rows[0] as { already_recorded: boolean }).already_recorded) {
      throw new ConflictException({
        code: "INCIDENT_ALREADY_RECORDED_FOR_OCCURRENCE",
        message: "An incident has already been recorded for the current scheduled occurrence; reschedule it before another incident",
      });
    }
  }

  private sessionCredits(session: LockedSession) {
    const durationMinutes = Math.round((session.ends_at.getTime() - session.starts_at.getTime()) / 60_000);
    if (durationMinutes === 30) return 1;
    if (durationMinutes === 60) return 2;
    throw new ConflictException({ code: "UNSUPPORTED_LESSON_DURATION", message: "Only 30 or 60 minute regular lessons are supported" });
  }

  private async lockActiveReservation(tx: any, sessionId: string, creditsNeeded: number) {
    const result = await tx.execute(sql`
      SELECT id, credits_reserved, status
      FROM session_credit_reservations
      WHERE session_id = ${sessionId}
      FOR UPDATE
    `);
    if (!result.rowCount) {
      throw new ConflictException({ code: "SESSION_CREDIT_RESERVATION_MISSING", message: "Paid lesson has no credit reservation" });
    }
    const reservation = result.rows[0] as { id: string; credits_reserved: number | string; status: string };
    if (reservation.status !== "ACTIVE" || Number(reservation.credits_reserved) !== creditsNeeded) {
      throw new ConflictException({ code: "SESSION_CREDIT_RESERVATION_INVALID", message: "Lesson credit reservation is not active or has an invalid amount" });
    }
    return reservation;
  }

  private async allocateCredits(tx: any, enrollmentId: string, creditsNeeded: number) {
    const grantsResult = await tx.execute(sql`
      SELECT
        g.id,
        (
          g.credits_granted
          - COALESCE((SELECT SUM(a.credits) FROM lesson_credit_allocations a WHERE a.grant_id = g.id), 0)
        )::int AS remaining_credits
      FROM lesson_credit_grants g
      WHERE g.enrollment_id = ${enrollmentId}
        AND (
          g.credits_granted
          - COALESCE((SELECT SUM(a.credits) FROM lesson_credit_allocations a WHERE a.grant_id = g.id), 0)
        ) > 0
      ORDER BY g.created_at, g.id
      FOR UPDATE OF g
    `);

    let remaining = creditsNeeded;
    const allocations: Array<{ grantId: string; credits: number }> = [];
    for (const grant of grantsResult.rows as Array<{ id: string; remaining_credits: number | string }>) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, Number(grant.remaining_credits));
      if (take > 0) {
        allocations.push({ grantId: grant.id, credits: take });
        remaining -= take;
      }
    }
    if (remaining > 0) {
      throw new ConflictException({ code: "INSUFFICIENT_LESSON_CREDITS", message: "Not enough lesson credits for this policy action" });
    }
    return allocations;
  }

  private async getTeacherRate60Minor(tx: any, teacherId: string, subjectId: string, lessonDateTime: Date) {
    const earnedForDate = formatInSchoolTimeZone(lessonDateTime).date;
    const [teacherSubject] = await tx
      .select({ id: teacherSubjects.id })
      .from(teacherSubjects)
      .where(and(eq(teacherSubjects.teacherId, teacherId), eq(teacherSubjects.subjectId, subjectId)))
      .limit(1);
    if (!teacherSubject) return null;

    const [rate] = await tx
      .select({ rate60Minor: teacherRateVersions.rate60Minor })
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
    return rate?.rate60Minor ?? null;
  }
}
