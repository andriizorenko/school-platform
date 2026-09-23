import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { liveSessions, sessionCreditReservations } from "@school/db";
import type { Database } from "@school/db";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database/database.constants";
import { numberSchoolSetting } from "../../common/settings/school-settings";
import {
  addDaysToDateOnly,
  addMinutes,
  isoDayOfWeek,
  schoolLocalDateTimeToUtc,
  todayInSchoolTimeZone,
} from "../../common/time/kyiv-time";

const MAX_MATERIALIZATION_DAYS = 1095;

type Executor = Database | any;

type ScheduleSlot = {
  id: string;
  dayOfWeek: number;
  startTime: string;
  durationMinutes: 30 | 60;
};

type ScheduleVersion = {
  id: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  slots: ScheduleSlot[];
};

type ExistingSession = {
  id: string;
  scheduleSlotId: string | null;
  occurrenceDate: string | null;
  status: "SCHEDULED" | "COMPLETED" | "CHARGED_NO_SHOW" | "CANCELLED" | "EXPIRED_UNPAID";
  startsAt: Date;
  endsAt: Date;
};

@Injectable()
export class FundingMaterializerService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async refreshEnrollment(enrollmentId: string, actorId: string, executor: Executor = this.db) {
    const enrollmentResult = await executor.execute(sql`
      SELECT
        e.id,
        e.student_id,
        e.subject_id,
        e.status,
        a.teacher_id
      FROM student_subject_enrollments e
      LEFT JOIN teacher_assignments a
        ON a.enrollment_id = e.id AND a.ended_at IS NULL
      WHERE e.id = ${enrollmentId}
      FOR UPDATE OF e
    `);

    if (!enrollmentResult.rowCount) {
      throw new NotFoundException({ code: "ENROLLMENT_NOT_FOUND", message: "Enrollment not found" });
    }

    const enrollment = enrollmentResult.rows[0] as {
      id: string;
      student_id: string;
      subject_id: string;
      status: string;
      teacher_id: string | null;
    };

    const balanceCredits = await this.getBalanceCredits(enrollmentId, executor);
    const bookingTailDays = await numberSchoolSetting(executor, "reservation_tail_days", 14);

    if (enrollment.status !== "ACTIVE") {
      await executor.execute(sql`
        UPDATE session_credit_reservations r
        SET status = 'RELEASED', updated_at = now()
        FROM live_sessions s
        WHERE r.session_id = s.id
          AND r.enrollment_id = ${enrollmentId}
          AND r.status = 'ACTIVE'
          AND s.status = 'SCHEDULED'
          AND s.starts_at >= now()
      `);
      await executor.execute(sql`
        UPDATE live_sessions
        SET status = 'EXPIRED_UNPAID', funding_status = 'BOOKED', updated_at = now()
        WHERE enrollment_id = ${enrollmentId}
          AND session_type = 'REGULAR'
          AND status = 'SCHEDULED'
          AND starts_at >= now()
      `);
      return {
        enrollmentId,
        balanceCredits,
        reservedCredits: 0,
        paidSessions: 0,
        bookedSessions: 0,
        materializedThrough: null,
      };
    }

    if (!enrollment.teacher_id) {
      return {
        enrollmentId,
        balanceCredits,
        reservedCredits: 0,
        paidSessions: 0,
        bookedSessions: 0,
        materializedThrough: null,
      };
    }

    const today = todayInSchoolTimeZone();
    const scheduleResult = await executor.execute(sql`
      SELECT
        v.id AS version_id,
        v.effective_from,
        v.effective_until,
        s.id AS slot_id,
        s.day_of_week,
        s.start_time,
        s.duration_minutes
      FROM regular_schedule_versions v
      JOIN regular_schedule_slots s ON s.schedule_version_id = v.id
      WHERE v.enrollment_id = ${enrollmentId}
        AND (v.effective_until IS NULL OR v.effective_until >= ${today})
      ORDER BY v.effective_from, s.day_of_week, s.start_time
    `);

    const versionsById = new Map<string, ScheduleVersion>();
    for (const row of scheduleResult.rows as Array<{
      version_id: string;
      effective_from: string;
      effective_until: string | null;
      slot_id: string;
      day_of_week: number;
      start_time: string;
      duration_minutes: 30 | 60;
    }>) {
      let version = versionsById.get(row.version_id);
      if (!version) {
        version = {
          id: row.version_id,
          effectiveFrom: row.effective_from,
          effectiveUntil: row.effective_until,
          slots: [],
        };
        versionsById.set(row.version_id, version);
      }
      version.slots.push({
        id: row.slot_id,
        dayOfWeek: row.day_of_week,
        startTime: row.start_time,
        durationMinutes: row.duration_minutes,
      });
    }

    const versions = [...versionsById.values()].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    if (!versions.length) {
      return {
        enrollmentId,
        balanceCredits,
        reservedCredits: 0,
        paidSessions: 0,
        bookedSessions: 0,
        materializedThrough: null,
      };
    }

    // Recompute all future funding because the credit ledger is authoritative.
    // This includes sessions from the still-active old schedule before a future schedule version begins.
    await executor.execute(sql`
      UPDATE session_credit_reservations r
      SET status = 'RELEASED', updated_at = now()
      FROM live_sessions s
      WHERE r.session_id = s.id
        AND r.enrollment_id = ${enrollmentId}
        AND r.status = 'ACTIVE'
        AND s.status IN ('SCHEDULED', 'EXPIRED_UNPAID', 'CANCELLED')
        AND s.starts_at >= now()
    `);

    await executor.execute(sql`
      UPDATE live_sessions
      SET funding_status = 'BOOKED', updated_at = now()
      WHERE enrollment_id = ${enrollmentId}
        AND session_type = 'REGULAR'
        AND status = 'SCHEDULED'
        AND starts_at >= now()
    `);

    const lockedReservationResult = await executor.execute(sql`
      SELECT COALESCE(SUM(r.credits_reserved), 0)::int AS credits
      FROM session_credit_reservations r
      JOIN live_sessions s ON s.id = r.session_id
      WHERE r.enrollment_id = ${enrollmentId}
        AND r.status = 'ACTIVE'
        AND s.status = 'SCHEDULED'
        AND s.starts_at < now()
    `);
    const lockedPastReservationCredits = Number(
      (lockedReservationResult.rows[0] as { credits: number | string }).credits,
    );

    const firstFutureScheduleDate = versions[0].effectiveFrom;
    const startDate = firstFutureScheduleDate > today ? firstFutureScheduleDate : today;
    const pauseResult = await executor.execute(sql`
      SELECT starts_on, returns_on
      FROM student_enrollment_pauses
      WHERE enrollment_id = ${enrollmentId}
        AND returns_on >= ${startDate}
      ORDER BY starts_on
    `);
    const pauses = pauseResult.rows as Array<{ starts_on: string; returns_on: string }>;
    const isPausedDate = (date: string) => pauses.some((pause) => pause.starts_on <= date && pause.returns_on > date);
    const allSlotIds = versions.flatMap((version) => version.slots.map((slot) => slot.id));

    const existingRows = allSlotIds.length
      ? await executor
          .select({
            id: liveSessions.id,
            scheduleSlotId: liveSessions.scheduleSlotId,
            occurrenceDate: liveSessions.occurrenceDate,
            status: liveSessions.status,
            startsAt: liveSessions.startsAt,
            endsAt: liveSessions.endsAt,
          })
          .from(liveSessions)
          .where(
            and(
              eq(liveSessions.enrollmentId, enrollmentId),
              inArray(liveSessions.scheduleSlotId, allSlotIds),
              gte(liveSessions.occurrenceDate, startDate),
            ),
          )
      : [];

    const existingByOccurrence = new Map<string, ExistingSession>();
    for (const row of existingRows as ExistingSession[]) {
      if (row.scheduleSlotId && row.occurrenceDate) {
        existingByOccurrence.set(`${row.scheduleSlotId}:${row.occurrenceDate}`, row);
      }
    }

    let creditsRemaining = Math.max(0, balanceCredits - lockedPastReservationCredits);
    let reservedCredits = lockedPastReservationCredits;
    let paidSessions = 0;
    let bookedSessions = 0;
    let paidPhase = true;
    let lastPaidDate: string | null = null;
    let tailEnd: string | null = null;
    let materializedThrough: string | null = null;

    for (let offset = 0; offset < MAX_MATERIALIZATION_DAYS; offset += 1) {
      const date = addDaysToDateOnly(startDate, offset);
      if (isPausedDate(date)) {
        materializedThrough = date;
        continue;
      }
      const version = versions.find(
        (candidate) => candidate.effectiveFrom <= date && (!candidate.effectiveUntil || candidate.effectiveUntil >= date),
      );
      const dayOfWeek = isoDayOfWeek(date);
      const daySlots = (version?.slots ?? [])
        .filter((slot) => slot.dayOfWeek === dayOfWeek)
        .sort((a, b) => a.startTime.localeCompare(b.startTime));

      for (const slot of daySlots) {
        const key = `${slot.id}:${date}`;
        let session = existingByOccurrence.get(key);

        if (session?.status === "CANCELLED" || session?.status === "COMPLETED" || session?.status === "CHARGED_NO_SHOW") {
          continue;
        }

        if (!paidPhase && tailEnd && date > tailEnd) break;

        const startsAt = session?.startsAt ?? schoolLocalDateTimeToUtc(date, slot.startTime);
        const endsAt = session?.endsAt ?? addMinutes(startsAt, slot.durationMinutes);

        if (!session) {
          const [created] = await executor
            .insert(liveSessions)
            .values({
              studentId: enrollment.student_id,
              enrollmentId,
              subjectId: enrollment.subject_id,
              primaryTeacherId: enrollment.teacher_id,
              actualTeacherId: enrollment.teacher_id,
              scheduleSlotId: slot.id,
              occurrenceDate: date,
              sessionType: "REGULAR",
              fundingStatus: "BOOKED",
              status: "SCHEDULED",
              startsAt,
              endsAt,
              createdBy: actorId,
            })
            .returning({
              id: liveSessions.id,
              scheduleSlotId: liveSessions.scheduleSlotId,
              occurrenceDate: liveSessions.occurrenceDate,
              status: liveSessions.status,
              startsAt: liveSessions.startsAt,
              endsAt: liveSessions.endsAt,
            });
          session = created as ExistingSession;
          existingByOccurrence.set(key, session);
        } else if (session.status === "EXPIRED_UNPAID") {
          await executor
            .update(liveSessions)
            .set({ status: "SCHEDULED", updatedAt: new Date() })
            .where(eq(liveSessions.id, session.id));
          session = { ...session, status: "SCHEDULED" };
          existingByOccurrence.set(key, session);
        }

        const creditsNeeded = slot.durationMinutes === 30 ? 1 : 2;
        if (paidPhase && creditsRemaining >= creditsNeeded) {
          creditsRemaining -= creditsNeeded;
          reservedCredits += creditsNeeded;
          paidSessions += 1;
          lastPaidDate = date;

          await executor
            .update(liveSessions)
            .set({ fundingStatus: "PAID", status: "SCHEDULED", updatedAt: new Date() })
            .where(eq(liveSessions.id, session.id));

          await executor
            .insert(sessionCreditReservations)
            .values({
              sessionId: session.id,
              enrollmentId,
              creditsReserved: creditsNeeded,
              status: "ACTIVE",
            })
            .onConflictDoUpdate({
              target: sessionCreditReservations.sessionId,
              set: {
                enrollmentId,
                creditsReserved: creditsNeeded,
                status: "ACTIVE",
                updatedAt: new Date(),
              },
            });
        } else {
          if (paidPhase) {
            paidPhase = false;
            tailEnd = addDaysToDateOnly(lastPaidDate ?? startDate, bookingTailDays);
          }

          if (tailEnd && date <= tailEnd) {
            bookedSessions += 1;
            await executor
              .update(liveSessions)
              .set({ fundingStatus: "BOOKED", status: "SCHEDULED", updatedAt: new Date() })
              .where(eq(liveSessions.id, session.id));
          }
        }

        materializedThrough = date;
      }

      if (!paidPhase && tailEnd && date >= tailEnd) {
        materializedThrough = tailEnd;
        break;
      }
    }

    if (paidPhase && creditsRemaining > 0) {
      throw new ConflictException({
        code: "BALANCE_MATERIALIZATION_HORIZON_EXCEEDED",
        message: "The lesson balance exceeds the current session materialization horizon",
        details: { remainingCredits: creditsRemaining, maxDays: MAX_MATERIALIZATION_DAYS },
      });
    }

    const keepThrough = materializedThrough ?? addDaysToDateOnly(startDate, bookingTailDays);
    await executor.execute(sql`
      UPDATE live_sessions
      SET status = 'EXPIRED_UNPAID', funding_status = 'BOOKED', updated_at = now()
      WHERE enrollment_id = ${enrollmentId}
        AND session_type = 'REGULAR'
        AND status = 'SCHEDULED'
        AND occurrence_date > ${keepThrough}
        AND starts_at >= now()
    `);

    return {
      enrollmentId,
      balanceCredits,
      reservedCredits,
      paidSessions,
      bookedSessions,
      materializedThrough: keepThrough,
    };
  }

  private async getBalanceCredits(enrollmentId: string, executor: Executor) {
    const result = await executor.execute(sql`
      SELECT
        COALESCE((SELECT SUM(credits_granted) FROM lesson_credit_grants WHERE enrollment_id = ${enrollmentId}), 0)::int
        - COALESCE((SELECT SUM(credits_debited) FROM lesson_credit_debits WHERE enrollment_id = ${enrollmentId}), 0)::int
        AS balance_credits
    `);
    return Number((result.rows[0] as { balance_credits: number | string }).balance_credits);
  }
}
