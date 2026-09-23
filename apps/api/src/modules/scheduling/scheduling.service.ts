import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  liveSessions,
  parentProfiles,
  regularScheduleSlots,
  regularScheduleVersions,
  sessionReschedules,
  studentSubjectEnrollments,
  students,
  subjects,
  teacherAssignments,
  teacherAvailabilityExceptionWindows,
  teacherAvailabilityExceptions,
  teacherAvailabilityTemplates,
  teacherAvailabilityWindows,
  teacherProfiles,
  teacherSubjects,
  teacherVacationRequests,
} from "@school/db";
import type { Database } from "@school/db";
import { and, asc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database/database.constants";
import { numberSchoolSetting, stringSchoolSetting } from "../../common/settings/school-settings";
import { isPgExclusionViolation, pgConstraint } from "../../common/database/pg-errors";
import {
  addDaysToDateOnly,
  addMinutes,
  availabilitySeasonForDate,
  formatInSchoolTimeZone,
  isoDayOfWeek,
  minutesSinceMidnight,
  schoolLocalDateTimeToUtc,
  todayInSchoolTimeZone,
} from "../../common/time/kyiv-time";
import type { AuthUser } from "../auth/types";
import { AuditService } from "../audit/audit.service";
import { OutboxService } from "../audit/outbox.service";
import type { CreateFirstLessonDto } from "./dto/create-first-lesson.dto";
import type { RescheduleSessionDto } from "./dto/reschedule-session.dto";
import type { FreeSlotsQueryDto } from "./dto/free-slots-query.dto";
import type { AssignSubstituteDto } from "./dto/assign-substitute.dto";
import type { ChangePrimaryTeacherDto } from "./dto/change-primary-teacher.dto";
import type { StudentPauseDto } from "./dto/student-pause.dto";
import type { SetRegularScheduleDto } from "./dto/set-regular-schedule.dto";
import { FundingMaterializerService } from "./funding-materializer.service";

const PRIVILEGED_ROLES = new Set(["ADMIN", "MANAGER", "SUPPORT_MANAGER"]);
const REGULAR_SCHEDULE_VALIDATION_DAYS = 28;

type AvailabilityWindow = { startTime: string; endTime: string };
type AvailabilitySnapshot = {
  templates: Map<string, Map<number, AvailabilityWindow[]>>;
  exceptions: Map<string, { unavailableAllDay: boolean; windows: AvailabilityWindow[] }>;
  vacations: Array<{ startsOn: string; endsOn: string }>;
  schoolYearStart: string;
  schoolYearEnd: string;
};

@Injectable()
export class SchedulingService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly fundingMaterializer: FundingMaterializerService,
  ) {}

  private validateRegularSlots(dto: SetRegularScheduleDto) {
    const byDay = new Map<number, Array<{ start: number; end: number }>>();

    for (const slot of dto.slots) {
      const start = minutesSinceMidnight(slot.startTime);
      const end = start + slot.durationMinutes;
      if (end > 24 * 60) {
        throw new BadRequestException({
          code: "INVALID_REGULAR_SCHEDULE_SLOT",
          message: "A regular lesson cannot cross midnight",
        });
      }

      const existing = byDay.get(slot.dayOfWeek) ?? [];
      if (existing.some((item) => start < item.end && end > item.start)) {
        throw new BadRequestException({
          code: "OVERLAPPING_REGULAR_SCHEDULE_SLOTS",
          message: "Regular schedule slots cannot overlap on the same day",
        });
      }
      existing.push({ start, end });
      byDay.set(slot.dayOfWeek, existing);
    }
  }

  private async loadAvailabilitySnapshot(
    executor: any,
    teacherId: string,
    fromDate: string,
    toDate: string,
  ): Promise<AvailabilitySnapshot> {
    const templateRows = await executor
      .select({
        season: teacherAvailabilityTemplates.season,
        dayOfWeek: teacherAvailabilityWindows.dayOfWeek,
        startTime: teacherAvailabilityWindows.startTime,
        endTime: teacherAvailabilityWindows.endTime,
      })
      .from(teacherAvailabilityTemplates)
      .leftJoin(
        teacherAvailabilityWindows,
        eq(teacherAvailabilityTemplates.id, teacherAvailabilityWindows.templateId),
      )
      .where(
        and(
          eq(teacherAvailabilityTemplates.teacherId, teacherId),
          eq(teacherAvailabilityTemplates.isActive, true),
        ),
      )
      .orderBy(asc(teacherAvailabilityWindows.dayOfWeek), asc(teacherAvailabilityWindows.startTime));

    const templates = new Map<string, Map<number, AvailabilityWindow[]>>();
    for (const row of templateRows as Array<{
      season: "SCHOOL_YEAR" | "SUMMER";
      dayOfWeek: number | null;
      startTime: string | null;
      endTime: string | null;
    }>) {
      let days = templates.get(row.season);
      if (!days) {
        days = new Map();
        templates.set(row.season, days);
      }
      if (row.dayOfWeek !== null && row.startTime && row.endTime) {
        const windows = days.get(row.dayOfWeek) ?? [];
        windows.push({ startTime: row.startTime, endTime: row.endTime });
        days.set(row.dayOfWeek, windows);
      }
    }

    const exceptionRows = await executor
      .select({
        id: teacherAvailabilityExceptions.id,
        date: teacherAvailabilityExceptions.exceptionDate,
        unavailableAllDay: teacherAvailabilityExceptions.isUnavailableAllDay,
      })
      .from(teacherAvailabilityExceptions)
      .where(
        and(
          eq(teacherAvailabilityExceptions.teacherId, teacherId),
          gte(teacherAvailabilityExceptions.exceptionDate, fromDate),
          lte(teacherAvailabilityExceptions.exceptionDate, toDate),
        ),
      );

    const exceptionIds = (exceptionRows as Array<{ id: string }>).map((row) => row.id);
    const exceptionWindowRows = exceptionIds.length
      ? await executor
          .select({
            exceptionId: teacherAvailabilityExceptionWindows.exceptionId,
            startTime: teacherAvailabilityExceptionWindows.startTime,
            endTime: teacherAvailabilityExceptionWindows.endTime,
          })
          .from(teacherAvailabilityExceptionWindows)
          .where(inArray(teacherAvailabilityExceptionWindows.exceptionId, exceptionIds))
      : [];

    const windowsByException = new Map<string, AvailabilityWindow[]>();
    for (const row of exceptionWindowRows as Array<{ exceptionId: string; startTime: string; endTime: string }>) {
      const windows = windowsByException.get(row.exceptionId) ?? [];
      windows.push({ startTime: row.startTime, endTime: row.endTime });
      windowsByException.set(row.exceptionId, windows);
    }

    const exceptions = new Map<string, { unavailableAllDay: boolean; windows: AvailabilityWindow[] }>();
    for (const row of exceptionRows as Array<{ id: string; date: string; unavailableAllDay: boolean }>) {
      exceptions.set(row.date, {
        unavailableAllDay: row.unavailableAllDay,
        windows: windowsByException.get(row.id) ?? [],
      });
    }

    const vacations = await executor
      .select({ startsOn: teacherVacationRequests.startsOn, endsOn: teacherVacationRequests.endsOn })
      .from(teacherVacationRequests)
      .where(
        and(
          eq(teacherVacationRequests.teacherId, teacherId),
          eq(teacherVacationRequests.status, "APPROVED"),
          lte(teacherVacationRequests.startsOn, toDate),
          gte(teacherVacationRequests.endsOn, fromDate),
        ),
      );

    const [schoolYearStart, schoolYearEnd] = await Promise.all([
      stringSchoolSetting(executor, "school_year_start", "09-01"),
      stringSchoolSetting(executor, "school_year_end", "05-31"),
    ]);

    return {
      templates,
      exceptions,
      vacations: vacations as Array<{ startsOn: string; endsOn: string }>,
      schoolYearStart,
      schoolYearEnd,
    };
  }

  private isTeacherAvailable(
    snapshot: AvailabilitySnapshot,
    date: string,
    dayOfWeek: number,
    startTime: string,
    durationMinutes: number,
  ) {
    if (snapshot.vacations.some((vacation) => vacation.startsOn <= date && vacation.endsOn >= date)) {
      return false;
    }

    const exception = snapshot.exceptions.get(date);
    let windows: AvailabilityWindow[];
    if (exception) {
      if (exception.unavailableAllDay) return false;
      windows = exception.windows;
    } else {
      const season = availabilitySeasonForDate(date, snapshot.schoolYearStart, snapshot.schoolYearEnd);
      windows = snapshot.templates.get(season)?.get(dayOfWeek) ?? [];
    }

    const start = minutesSinceMidnight(startTime);
    const end = start + durationMinutes;
    return windows.some(
      (window) => start >= minutesSinceMidnight(window.startTime) && end <= minutesSinceMidnight(window.endTime),
    );
  }


  private async assertCanRescheduleSession(executor: any, session: {
    student_id: string;
    actual_teacher_id: string;
    starts_at: Date;
  }, actor: AuthUser) {
    const privileged = actor.roles.some((role) => PRIVILEGED_ROLES.has(role));
    const isTeacher = actor.roles.includes("TEACHER") && actor.id === session.actual_teacher_id;
    let isParent = false;

    if (actor.roles.includes("PARENT")) {
      const [parent] = await executor
        .select({ familyId: parentProfiles.familyId })
        .from(parentProfiles)
        .where(eq(parentProfiles.userId, actor.id))
        .limit(1);
      const [student] = await executor
        .select({ familyId: students.familyId })
        .from(students)
        .where(eq(students.id, session.student_id))
        .limit(1);
      isParent = Boolean(parent && student && parent.familyId === student.familyId);
    }

    if (!privileged && !isTeacher && !isParent) {
      throw new ForbiddenException({ code: "SESSION_SCOPE_DENIED", message: "You cannot reschedule this lesson" });
    }

    if (isParent) {
      const cutoffMinutes = await numberSchoolSetting(executor, "parent_reschedule_cutoff_minutes", 120);
      const cutoffMs = cutoffMinutes * 60 * 1000;
      if (session.starts_at.getTime() - Date.now() < cutoffMs) {
        throw new ConflictException({
          code: "PARENT_RESCHEDULE_CUTOFF",
          message: `Parents can reschedule only at least ${cutoffMinutes} minutes before the current lesson start`,
        });
      }
    }

    return { privileged, isTeacher, isParent };
  }

  private async loadBusyIntervals(
    executor: any,
    session: { id: string; student_id: string; actual_teacher_id: string },
    from: Date,
    to: Date,
  ): Promise<Array<{ id: string; startsAt: Date; endsAt: Date }>> {
    const result = await executor.execute(sql`
      SELECT id, starts_at, ends_at
      FROM live_sessions
      WHERE id <> ${session.id}
        AND status IN ('SCHEDULED', 'COMPLETED', 'CHARGED_NO_SHOW')
        AND starts_at < ${to}
        AND ends_at > ${from}
        AND (actual_teacher_id = ${session.actual_teacher_id} OR student_id = ${session.student_id})
      ORDER BY starts_at
    `);
    return result.rows.map((row: any) => ({
      id: row.id as string,
      startsAt: new Date(row.starts_at),
      endsAt: new Date(row.ends_at),
    }));
  }

  private intervalIsFree(
    busy: Array<{ startsAt: Date; endsAt: Date }>,
    startsAt: Date,
    endsAt: Date,
  ) {
    return !busy.some((item) => startsAt < item.endsAt && endsAt > item.startsAt);
  }

  async listFreeSlots(sessionId: string, query: FreeSlotsQueryDto, actor: AuthUser) {
    const result = await this.db.execute(sql`
      SELECT id, student_id, enrollment_id, actual_teacher_id, session_type,
             starts_at, ends_at, status
      FROM live_sessions
      WHERE id = ${sessionId}
      LIMIT 1
    `);
    if (!result.rowCount) throw new NotFoundException({ code: "SESSION_NOT_FOUND", message: "Lesson not found" });

    const session = result.rows[0] as {
      id: string;
      student_id: string;
      enrollment_id: string | null;
      actual_teacher_id: string;
      session_type: "FIRST" | "REGULAR";
      starts_at: Date;
      ends_at: Date;
      status: string;
    };
    if (session.status !== "SCHEDULED") {
      throw new ConflictException({ code: "SESSION_NOT_SCHEDULED", message: "Only scheduled lessons can be moved" });
    }
    await this.assertCanRescheduleSession(this.db, session, actor);

    const fromDate = query.from ?? todayInSchoolTimeZone();
    const days = query.days ?? 14;
    const toDate = addDaysToDateOnly(fromDate, days - 1);
    const fromUtc = schoolLocalDateTimeToUtc(fromDate, "00:00");
    const toUtc = schoolLocalDateTimeToUtc(addDaysToDateOnly(toDate, 1), "00:00");
    const durationMinutes = Math.round((session.ends_at.getTime() - session.starts_at.getTime()) / 60_000);
    const availability = await this.loadAvailabilitySnapshot(this.db, session.actual_teacher_id, fromDate, toDate);
    const busy = await this.loadBusyIntervals(this.db, session, fromUtc, toUtc);
    const now = new Date();
    const slots: Array<{ startsAt: string; endsAt: string; date: string; time: string }> = [];

    for (let offset = 0; offset < days; offset += 1) {
      const date = addDaysToDateOnly(fromDate, offset);
      const dayOfWeek = isoDayOfWeek(date);
      for (let minute = 0; minute < 24 * 60; minute += 30) {
        const hour = String(Math.floor(minute / 60)).padStart(2, "0");
        const min = String(minute % 60).padStart(2, "0");
        const time = `${hour}:${min}`;
        if (!this.isTeacherAvailable(availability, date, dayOfWeek, time, durationMinutes)) continue;
        const startsAt = schoolLocalDateTimeToUtc(date, time);
        const endsAt = addMinutes(startsAt, durationMinutes);
        if (startsAt <= now) continue;
        if (startsAt.getTime() === session.starts_at.getTime()) continue;
        if (!this.intervalIsFree(busy, startsAt, endsAt)) continue;
        slots.push({ startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), date, time });
        if (slots.length >= 160) break;
      }
      if (slots.length >= 160) break;
    }

    return {
      sessionId,
      teacherId: session.actual_teacher_id,
      durationMinutes,
      from: fromDate,
      to: toDate,
      slots,
      canMoveToEnd: session.session_type === "REGULAR" && Boolean(session.enrollment_id),
    };
  }

  private async findEndOfSequenceTarget(executor: any, session: {
    id: string;
    student_id: string;
    enrollment_id: string | null;
    actual_teacher_id: string;
    starts_at: Date;
    ends_at: Date;
    session_type: string;
  }) {
    if (session.session_type !== "REGULAR" || !session.enrollment_id) {
      throw new ConflictException({
        code: "END_OF_SUBSCRIPTION_NOT_AVAILABLE",
        message: "Only regular lessons can be moved to the end of the subscription",
      });
    }

    const paidResult = await executor.execute(sql`
      SELECT COALESCE(MAX(starts_at), ${session.starts_at}) AS last_paid_at
      FROM live_sessions
      WHERE enrollment_id = ${session.enrollment_id}
        AND session_type = 'REGULAR'
        AND status = 'SCHEDULED'
        AND funding_status = 'PAID'
    `);
    const lastPaidAt = new Date((paidResult.rows[0] as any).last_paid_at);

    const booked = await executor.execute(sql`
      SELECT id, starts_at, ends_at
      FROM live_sessions
      WHERE enrollment_id = ${session.enrollment_id}
        AND id <> ${session.id}
        AND session_type = 'REGULAR'
        AND status = 'SCHEDULED'
        AND funding_status = 'BOOKED'
        AND starts_at > ${lastPaidAt}
      ORDER BY starts_at
      FOR UPDATE
    `);

    for (const row of booked.rows as any[]) {
      const startsAt = new Date(row.starts_at);
      const endsAt = new Date(row.ends_at);
      const local = formatInSchoolTimeZone(startsAt);
      const durationMinutes = Math.round((session.ends_at.getTime() - session.starts_at.getTime()) / 60_000);
      const availability = await this.loadAvailabilitySnapshot(executor, session.actual_teacher_id, local.date, local.date);
      if (!this.isTeacherAvailable(availability, local.date, isoDayOfWeek(local.date), local.time, durationMinutes)) continue;
      const busy = await this.loadBusyIntervals(executor, session, startsAt, endsAt);
      const withoutPlaceholder = busy.filter((item) => item.id !== row.id);
      if (!this.intervalIsFree(withoutPlaceholder, startsAt, endsAt)) continue;
      return { startsAt, placeholderId: row.id as string };
    }

    const anchorResult = await executor.execute(sql`
      SELECT COALESCE(MAX(starts_at), ${lastPaidAt}) AS last_planned_at
      FROM live_sessions
      WHERE enrollment_id = ${session.enrollment_id}
        AND id <> ${session.id}
        AND session_type = 'REGULAR'
        AND status = 'SCHEDULED'
    `);
    const anchor = new Date((anchorResult.rows[0] as any).last_planned_at);
    const anchorLocal = formatInSchoolTimeZone(anchor);
    const horizonEnd = addDaysToDateOnly(anchorLocal.date, 180);
    const availability = await this.loadAvailabilitySnapshot(executor, session.actual_teacher_id, anchorLocal.date, horizonEnd);
    const scheduleRows = await executor.execute(sql`
      SELECT v.effective_from, v.effective_until, s.day_of_week, s.start_time, s.duration_minutes
      FROM regular_schedule_versions v
      JOIN regular_schedule_slots s ON s.schedule_version_id = v.id
      WHERE v.enrollment_id = ${session.enrollment_id}
        AND (v.effective_until IS NULL OR v.effective_until >= ${anchorLocal.date})
      ORDER BY v.effective_from, s.day_of_week, s.start_time
    `);
    const rows = scheduleRows.rows as Array<{
      effective_from: string;
      effective_until: string | null;
      day_of_week: number;
      start_time: string;
      duration_minutes: number;
    }>;
    const rangeStartUtc = schoolLocalDateTimeToUtc(anchorLocal.date, "00:00");
    const rangeEndUtc = schoolLocalDateTimeToUtc(addDaysToDateOnly(horizonEnd, 1), "00:00");
    const busy = await this.loadBusyIntervals(executor, session, rangeStartUtc, rangeEndUtc);
    const sessionDuration = Math.round((session.ends_at.getTime() - session.starts_at.getTime()) / 60_000);

    for (let offset = 0; offset <= 180; offset += 1) {
      const date = addDaysToDateOnly(anchorLocal.date, offset);
      const day = isoDayOfWeek(date);
      const applicable = rows.filter((row) =>
        row.day_of_week === day &&
        row.effective_from <= date &&
        (!row.effective_until || row.effective_until >= date)
      );
      for (const slot of applicable) {
        if (slot.duration_minutes !== sessionDuration) continue;
        const startsAt = schoolLocalDateTimeToUtc(date, slot.start_time);
        if (startsAt <= anchor) continue;
        const endsAt = addMinutes(startsAt, sessionDuration);
        if (!this.isTeacherAvailable(availability, date, day, slot.start_time, sessionDuration)) continue;
        if (!this.intervalIsFree(busy, startsAt, endsAt)) continue;
        return { startsAt, placeholderId: null as string | null };
      }
    }

    throw new ConflictException({
      code: "END_OF_SUBSCRIPTION_SLOT_NOT_FOUND",
      message: "No free regular slot was found after the current planned sequence",
    });
  }

  async setRegularSchedule(
    enrollmentId: string,
    dto: SetRegularScheduleDto,
    actor: AuthUser,
    requestId?: string,
  ) {
    this.validateRegularSlots(dto);
    const today = todayInSchoolTimeZone();
    if (dto.effectiveFrom < today) {
      throw new BadRequestException({
        code: "REGULAR_SCHEDULE_EFFECTIVE_DATE_IN_PAST",
        message: "A new regular schedule must start today or later",
      });
    }

    try {
      return await this.db.transaction(async (tx) => {
        const locked = await tx.execute(sql`
          SELECT id, student_id, subject_id, status
          FROM student_subject_enrollments
          WHERE id = ${enrollmentId}
          FOR UPDATE
        `);

        if (!locked.rowCount) {
          throw new NotFoundException({ code: "ENROLLMENT_NOT_FOUND", message: "Enrollment not found" });
        }

        const enrollment = locked.rows[0] as {
          id: string;
          student_id: string;
          subject_id: string;
          status: string;
        };
        if (enrollment.status !== "ACTIVE") {
          throw new ConflictException({
            code: "ENROLLMENT_NOT_ACTIVE",
            message: "Regular schedule can only be set for an active enrollment",
          });
        }

        const [assignment] = await tx
          .select({ teacherId: teacherAssignments.teacherId })
          .from(teacherAssignments)
          .where(and(eq(teacherAssignments.enrollmentId, enrollmentId), isNull(teacherAssignments.endedAt)))
          .limit(1);
        if (!assignment) {
          throw new ConflictException({
            code: "PRIMARY_TEACHER_REQUIRED",
            message: "Assign a primary teacher before setting a regular schedule",
          });
        }

        const [currentVersion] = await tx
          .select({ id: regularScheduleVersions.id, effectiveFrom: regularScheduleVersions.effectiveFrom })
          .from(regularScheduleVersions)
          .where(and(eq(regularScheduleVersions.enrollmentId, enrollmentId), isNull(regularScheduleVersions.effectiveUntil)))
          .limit(1);

        if (currentVersion && dto.effectiveFrom <= currentVersion.effectiveFrom) {
          throw new ConflictException({
            code: "REGULAR_SCHEDULE_VERSION_ORDER_CONFLICT",
            message: "The new schedule must start after the current schedule version",
          });
        }

        let previousSchedule: unknown = null;
        if (currentVersion) {
          const oldSlots = await tx
            .select({
              id: regularScheduleSlots.id,
              dayOfWeek: regularScheduleSlots.dayOfWeek,
              startTime: regularScheduleSlots.startTime,
              durationMinutes: regularScheduleSlots.durationMinutes,
            })
            .from(regularScheduleSlots)
            .where(eq(regularScheduleSlots.scheduleVersionId, currentVersion.id));
          previousSchedule = { ...currentVersion, slots: oldSlots };

          await tx
            .update(regularScheduleVersions)
            .set({ effectiveUntil: addDaysToDateOnly(dto.effectiveFrom, -1) })
            .where(eq(regularScheduleVersions.id, currentVersion.id));

          const oldSlotIds = oldSlots.map((slot) => slot.id);
          if (oldSlotIds.length) {
            const cutoff = schoolLocalDateTimeToUtc(dto.effectiveFrom, "00:00");
            await tx
              .update(liveSessions)
              .set({ status: "CANCELLED", updatedAt: new Date() })
              .where(
                and(
                  inArray(liveSessions.scheduleSlotId, oldSlotIds),
                  eq(liveSessions.status, "SCHEDULED"),
                  gte(liveSessions.startsAt, cutoff),
                ),
              );
          }
        }

        const [version] = await tx
          .insert(regularScheduleVersions)
          .values({ enrollmentId, effectiveFrom: dto.effectiveFrom, createdBy: actor.id })
          .returning();

        const insertedSlots = await tx
          .insert(regularScheduleSlots)
          .values(
            dto.slots.map((slot) => ({
              scheduleVersionId: version.id,
              dayOfWeek: slot.dayOfWeek,
              startTime: slot.startTime,
              durationMinutes: slot.durationMinutes,
            })),
          )
          .returning();

        const validationFrom = dto.effectiveFrom > today ? dto.effectiveFrom : today;
        const validationTo = addDaysToDateOnly(validationFrom, REGULAR_SCHEDULE_VALIDATION_DAYS - 1);
        const availability = await this.loadAvailabilitySnapshot(tx, assignment.teacherId, validationFrom, validationTo);

        for (let offset = 0; offset < REGULAR_SCHEDULE_VALIDATION_DAYS; offset += 1) {
          const date = addDaysToDateOnly(validationFrom, offset);
          const dayOfWeek = isoDayOfWeek(date);

          for (const slot of insertedSlots.filter((item) => item.dayOfWeek === dayOfWeek)) {
            if (!this.isTeacherAvailable(availability, date, dayOfWeek, slot.startTime, slot.durationMinutes)) {
              throw new ConflictException({
                code: "TEACHER_NOT_AVAILABLE",
                message: "The regular schedule contains a time outside the teacher's availability",
                details: { date, startTime: slot.startTime, durationMinutes: slot.durationMinutes },
              });
            }
          }
        }

        const fundingPlan = await this.fundingMaterializer.refreshEnrollment(enrollmentId, actor.id, tx);

        await tx.execute(sql`
          UPDATE progress_report_requests rr
          SET target_session_id = (
            SELECT ls.id
            FROM live_sessions ls
            WHERE ls.enrollment_id = ${enrollmentId}
              AND ls.session_type = 'REGULAR'
              AND ls.status = 'SCHEDULED'
              AND ls.starts_at > now()
            ORDER BY ls.starts_at ASC
            LIMIT 1
          )
          WHERE rr.enrollment_id = ${enrollmentId}
            AND rr.status = 'PENDING'
            AND (
              rr.target_session_id IS NULL
              OR NOT EXISTS (
                SELECT 1 FROM live_sessions current_target
                WHERE current_target.id = rr.target_session_id
                  AND current_target.status = 'SCHEDULED'
              )
            )
        `);

        await this.audit.record(
          {
            actorUserId: actor.id,
            actorRoleCode: actor.roles[0],
            action: currentVersion ? "CHANGE_REGULAR_SCHEDULE" : "CREATE_REGULAR_SCHEDULE",
            entityType: "RegularScheduleVersion",
            entityId: version.id,
            requestId,
            beforeData: previousSchedule,
            afterData: {
              enrollmentId,
              teacherId: assignment.teacherId,
              effectiveFrom: dto.effectiveFrom,
              slots: dto.slots,
              fundingPlan,
            },
          },
          tx,
        );

        const notificationContext = await this.loadStudentNotificationContext(tx, enrollment.student_id);
        const scheduleText = dto.slots
          .map((slot) => `${["", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"][slot.dayOfWeek]} ${slot.startTime}`)
          .join(", ");
        if (!currentVersion) {
          await this.outbox.publishNotification(
            {
              aggregateType: "StudentSubjectEnrollment",
              aggregateId: enrollmentId,
              recipientUserIds: [assignment.teacherId],
              eventType: "REGULAR_STUDENT_ASSIGNED",
              title: "Новий регулярний учень",
              body: `${notificationContext.studentFullName} · ${scheduleText}`,
              actionPath: `/teacher/students/${enrollment.student_id}`,
              entityType: "StudentSubjectEnrollment",
              entityId: enrollmentId,
              data: { studentId: enrollment.student_id, enrollmentId, schedule: dto.slots },
            },
            tx,
          );
        } else {
          await this.outbox.publishNotification(
            {
              aggregateType: "RegularScheduleVersion",
              aggregateId: version.id,
              recipientUserIds: [assignment.teacherId, notificationContext.parentUserId, notificationContext.studentUserId].filter((id): id is string => Boolean(id) && id !== actor.id),
              eventType: "REGULAR_SCHEDULE_CHANGED",
              title: "Змінено регулярний графік",
              body: `${notificationContext.studentFullName} · ${scheduleText} · з ${dto.effectiveFrom}`,
              actionPath: actor.roles.includes("TEACHER") ? `/teacher/schedule` : `/parent`,
              entityType: "RegularScheduleVersion",
              entityId: version.id,
              data: { studentId: enrollment.student_id, enrollmentId, schedule: dto.slots, effectiveFrom: dto.effectiveFrom },
            },
            tx,
          );
        }

        return {
          id: version.id,
          enrollmentId,
          effectiveFrom: version.effectiveFrom,
          slots: insertedSlots,
          fundingPlan,
        };
      });
    } catch (error) {
      if (isPgExclusionViolation(error)) {
        const constraint = pgConstraint(error);
        if (constraint === "teacher_session_no_overlap") {
          throw new ConflictException({ code: "TEACHER_SESSION_CONFLICT", message: "Teacher already has a lesson in this time range" });
        }
        if (constraint === "student_session_no_overlap") {
          throw new ConflictException({ code: "STUDENT_SESSION_CONFLICT", message: "Student already has a lesson in this time range" });
        }
        if (constraint === "regular_schedule_version_no_overlap") {
          throw new ConflictException({ code: "REGULAR_SCHEDULE_VERSION_CONFLICT", message: "Regular schedule versions overlap" });
        }
      }
      throw error;
    }
  }

  async changePrimaryTeacher(
    enrollmentId: string,
    dto: ChangePrimaryTeacherDto,
    actor: AuthUser,
    requestId?: string,
  ) {
    try {
      return await this.db.transaction(async (tx) => {
        const enrollmentResult = await tx.execute(sql`
          SELECT e.id, e.student_id, e.subject_id, e.status, s.name AS subject_name
          FROM student_subject_enrollments e
          JOIN subjects s ON s.id = e.subject_id
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
          subject_name: string;
          status: string;
        };
        if (enrollment.status === "INACTIVE") {
          throw new ConflictException({
            code: "ENROLLMENT_INACTIVE",
            message: "Reactivate the enrollment before changing its primary teacher",
          });
        }

        const candidateResult = await tx.execute(sql`
          SELECT tp.user_id, tp.first_name, tp.last_name
          FROM teacher_profiles tp
          JOIN teacher_subjects ts ON ts.teacher_id = tp.user_id
          WHERE tp.user_id = ${dto.teacherId}
            AND tp.status = 'ACTIVE'
            AND tp.archived_at IS NULL
            AND ts.subject_id = ${enrollment.subject_id}
            AND ts.is_active = true
          LIMIT 1
        `);
        if (!candidateResult.rowCount) {
          throw new ConflictException({
            code: "TEACHER_DOES_NOT_TEACH_SUBJECT",
            message: "The selected teacher is not active for this subject",
          });
        }
        const candidate = candidateResult.rows[0] as { user_id: string; first_name: string; last_name: string };

        const currentResult = await tx.execute(sql`
          SELECT id, teacher_id
          FROM teacher_assignments
          WHERE enrollment_id = ${enrollmentId} AND ended_at IS NULL
          LIMIT 1
          FOR UPDATE
        `);
        const current = currentResult.rowCount
          ? (currentResult.rows[0] as { id: string; teacher_id: string })
          : null;
        if (current?.teacher_id === dto.teacherId) {
          return {
            enrollmentId,
            changed: false,
            primaryTeacher: { id: candidate.user_id, firstName: candidate.first_name, lastName: candidate.last_name },
          };
        }

        const today = todayInSchoolTimeZone();
        const openScheduleResult = await tx.execute(sql`
          SELECT id, effective_from
          FROM regular_schedule_versions
          WHERE enrollment_id = ${enrollmentId}
            AND effective_until IS NULL
          ORDER BY effective_from DESC
          LIMIT 1
        `);
        const openSchedule = openScheduleResult.rowCount
          ? (openScheduleResult.rows[0] as { id: string; effective_from: string })
          : null;
        const scheduleSlots = openSchedule
          ? await tx
              .select({
                dayOfWeek: regularScheduleSlots.dayOfWeek,
                startTime: regularScheduleSlots.startTime,
                durationMinutes: regularScheduleSlots.durationMinutes,
              })
              .from(regularScheduleSlots)
              .where(eq(regularScheduleSlots.scheduleVersionId, openSchedule.id))
          : [];

        const futureSessionsResult = await tx.execute(sql`
          SELECT id, starts_at, ends_at, actual_teacher_id
          FROM live_sessions
          WHERE enrollment_id = ${enrollmentId}
            AND status = 'SCHEDULED'
            AND starts_at >= now()
          ORDER BY starts_at
          FOR UPDATE
        `);
        const futureSessions = futureSessionsResult.rows as Array<{
          id: string;
          starts_at: Date;
          ends_at: Date;
          actual_teacher_id: string;
        }>;

        const requiredIntervals: Array<{ startsAt: Date; endsAt: Date; source: "SCHEDULE" | "SESSION" }> = [];
        if (openSchedule && scheduleSlots.length) {
          const validationFrom = openSchedule.effective_from > today ? openSchedule.effective_from : today;
          for (let offset = 0; offset < REGULAR_SCHEDULE_VALIDATION_DAYS; offset += 1) {
            const date = addDaysToDateOnly(validationFrom, offset);
            const dayOfWeek = isoDayOfWeek(date);
            for (const slot of scheduleSlots.filter((item) => item.dayOfWeek === dayOfWeek)) {
              const startsAt = schoolLocalDateTimeToUtc(date, slot.startTime);
              if (startsAt <= new Date()) continue;
              requiredIntervals.push({ startsAt, endsAt: addMinutes(startsAt, slot.durationMinutes), source: "SCHEDULE" });
            }
          }
        }
        for (const session of futureSessions) {
          if (!current || session.actual_teacher_id === current.teacher_id) {
            requiredIntervals.push({ startsAt: new Date(session.starts_at), endsAt: new Date(session.ends_at), source: "SESSION" });
          }
        }

        if (requiredIntervals.length) {
          const first = requiredIntervals.reduce((min, item) => item.startsAt < min ? item.startsAt : min, requiredIntervals[0].startsAt);
          const last = requiredIntervals.reduce((max, item) => item.endsAt > max ? item.endsAt : max, requiredIntervals[0].endsAt);
          const firstLocal = formatInSchoolTimeZone(first);
          const lastLocal = formatInSchoolTimeZone(last);
          const availability = await this.loadAvailabilitySnapshot(tx, dto.teacherId, firstLocal.date, lastLocal.date);

          const busyResult = await tx.execute(sql`
            SELECT id, starts_at, ends_at
            FROM live_sessions
            WHERE actual_teacher_id = ${dto.teacherId}
              AND status = 'SCHEDULED'
              AND enrollment_id IS DISTINCT FROM ${enrollmentId}::uuid
              AND starts_at < ${last}
              AND ends_at > ${first}
            ORDER BY starts_at
          `);
          const busy = (busyResult.rows as any[]).map((row) => ({
            id: row.id as string,
            startsAt: new Date(row.starts_at),
            endsAt: new Date(row.ends_at),
          }));

          for (const interval of requiredIntervals) {
            const local = formatInSchoolTimeZone(interval.startsAt);
            const durationMinutes = Math.round((interval.endsAt.getTime() - interval.startsAt.getTime()) / 60_000);
            if (!this.isTeacherAvailable(availability, local.date, isoDayOfWeek(local.date), local.time, durationMinutes)) {
              throw new ConflictException({
                code: "NEW_TEACHER_NOT_AVAILABLE",
                message: "The selected teacher cannot preserve the current student schedule",
                details: { startsAt: interval.startsAt.toISOString(), durationMinutes, source: interval.source },
              });
            }
            if (!this.intervalIsFree(busy, interval.startsAt, interval.endsAt)) {
              throw new ConflictException({
                code: "NEW_TEACHER_SESSION_CONFLICT",
                message: "The selected teacher has a conflicting lesson in the current student schedule",
                details: { startsAt: interval.startsAt.toISOString(), durationMinutes, source: interval.source },
              });
            }
          }
        }

        const changedAt = new Date();
        if (current) {
          await tx.execute(sql`
            UPDATE teacher_assignments
            SET ended_at = ${changedAt}
            WHERE id = ${current.id}
          `);
        }
        const assignmentResult = await tx.execute(sql`
          INSERT INTO teacher_assignments(enrollment_id, teacher_id, started_at, assigned_by)
          VALUES(${enrollmentId}, ${dto.teacherId}, ${changedAt}, ${actor.id})
          RETURNING id, started_at
        `);
        const assignment = assignmentResult.rows[0] as { id: string; started_at: Date };

        if (futureSessions.length) {
          await tx.execute(sql`
            UPDATE live_sessions
            SET
              primary_teacher_id = ${dto.teacherId},
              actual_teacher_id = CASE
                WHEN actual_teacher_id = ${current?.teacher_id ?? dto.teacherId} THEN ${dto.teacherId}
                ELSE actual_teacher_id
              END,
              updated_at = now()
            WHERE enrollment_id = ${enrollmentId}
              AND status = 'SCHEDULED'
              AND starts_at >= now()
          `);
        }

        await this.audit.record(
          {
            actorUserId: actor.id,
            actorRoleCode: actor.roles[0],
            action: current ? "CHANGE_PRIMARY_TEACHER" : "ASSIGN_PRIMARY_TEACHER",
            entityType: "StudentSubjectEnrollment",
            entityId: enrollmentId,
            requestId,
            beforeData: { teacherId: current?.teacher_id ?? null },
            afterData: {
              teacherId: dto.teacherId,
              assignmentId: assignment.id,
              futureSessionsUpdated: futureSessions.length,
              preservedSchedule: true,
            },
          },
          tx,
        );

        const ctx = await this.loadStudentNotificationContext(tx, enrollment.student_id);
        const scheduleText = scheduleSlots.length
          ? scheduleSlots
              .map((slot) => `${["", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"][slot.dayOfWeek]} ${slot.startTime}`)
              .join(", ")
          : "без регулярного графіка";
        const teacherName = `${candidate.last_name} ${candidate.first_name}`;
        await this.outbox.publishNotification(
          {
            aggregateType: "StudentSubjectEnrollment",
            aggregateId: enrollmentId,
            recipientUserIds: [dto.teacherId],
            eventType: "PRIMARY_TEACHER_CHANGED",
            title: current ? "Вам передано регулярного учня" : "Новий регулярний учень",
            body: `${ctx.studentFullName} · ${enrollment.subject_name} · ${scheduleText}`,
            actionPath: `/teacher/students/${enrollment.student_id}`,
            entityType: "StudentSubjectEnrollment",
            entityId: enrollmentId,
            data: { studentId: enrollment.student_id, enrollmentId, previousTeacherId: current?.teacher_id ?? null },
          },
          tx,
        );
        if (ctx.parentUserId) {
          await this.outbox.publishNotification(
            {
              aggregateType: "StudentSubjectEnrollment",
              aggregateId: enrollmentId,
              recipientUserIds: [ctx.parentUserId],
              eventType: "PRIMARY_TEACHER_CHANGED",
              title: "Змінено основного викладача",
              body: `${ctx.studentFullName} · ${enrollment.subject_name} · ${teacherName}`,
              actionPath: "/parent/learning",
              entityType: "StudentSubjectEnrollment",
              entityId: enrollmentId,
              data: { studentId: enrollment.student_id, enrollmentId, teacherId: dto.teacherId },
            },
            tx,
          );
        }
        if (ctx.studentUserId) {
          await this.outbox.publishNotification(
            {
              aggregateType: "StudentSubjectEnrollment",
              aggregateId: enrollmentId,
              recipientUserIds: [ctx.studentUserId],
              eventType: "PRIMARY_TEACHER_CHANGED",
              title: "Змінено основного викладача",
              body: `${enrollment.subject_name} · ${teacherName}`,
              actionPath: "/student/journal",
              entityType: "StudentSubjectEnrollment",
              entityId: enrollmentId,
              data: { studentId: enrollment.student_id, enrollmentId, teacherId: dto.teacherId },
            },
            tx,
          );
        }

        return {
          enrollmentId,
          changed: true,
          previousTeacherId: current?.teacher_id ?? null,
          primaryTeacher: { id: candidate.user_id, firstName: candidate.first_name, lastName: candidate.last_name },
          futureSessionsUpdated: futureSessions.length,
          schedulePreserved: true,
        };
      });
    } catch (error) {
      if (isPgExclusionViolation(error) && pgConstraint(error) === "teacher_session_no_overlap") {
        throw new ConflictException({
          code: "NEW_TEACHER_SESSION_CONFLICT",
          message: "The selected teacher has a conflicting lesson in the current student schedule",
        });
      }
      throw error;
    }
  }

  async getRegularSchedule(enrollmentId: string, actor: AuthUser) {
    const [enrollment] = await this.db
      .select({
        id: studentSubjectEnrollments.id,
        studentId: studentSubjectEnrollments.studentId,
      })
      .from(studentSubjectEnrollments)
      .where(eq(studentSubjectEnrollments.id, enrollmentId))
      .limit(1);
    if (!enrollment) {
      throw new NotFoundException({ code: "ENROLLMENT_NOT_FOUND", message: "Enrollment not found" });
    }

    const privileged = actor.roles.some((role) => PRIVILEGED_ROLES.has(role));
    if (!privileged) {
      let allowed = false;
      if (actor.roles.includes("TEACHER")) {
        const [assignment] = await this.db
          .select({ teacherId: teacherAssignments.teacherId })
          .from(teacherAssignments)
          .where(and(eq(teacherAssignments.enrollmentId, enrollmentId), isNull(teacherAssignments.endedAt)))
          .limit(1);
        allowed = assignment?.teacherId === actor.id;
      } else if (actor.roles.includes("PARENT")) {
        const [row] = await this.db
          .select({ parentFamilyId: parentProfiles.familyId, studentFamilyId: students.familyId })
          .from(students)
          .innerJoin(parentProfiles, eq(parentProfiles.userId, actor.id))
          .where(eq(students.id, enrollment.studentId))
          .limit(1);
        allowed = Boolean(row && row.parentFamilyId === row.studentFamilyId);
      } else if (actor.roles.includes("STUDENT")) {
        const [student] = await this.db
          .select({ userId: students.userId })
          .from(students)
          .where(eq(students.id, enrollment.studentId))
          .limit(1);
        allowed = student?.userId === actor.id;
      }

      if (!allowed) {
        throw new ForbiddenException({ code: "SCHEDULE_SCOPE_DENIED", message: "You cannot view this schedule" });
      }
    }

    const versions = await this.db
      .select()
      .from(regularScheduleVersions)
      .where(eq(regularScheduleVersions.enrollmentId, enrollmentId))
      .orderBy(asc(regularScheduleVersions.effectiveFrom));

    const versionIds = versions.map((version) => version.id);
    const slots = versionIds.length
      ? await this.db
          .select()
          .from(regularScheduleSlots)
          .where(inArray(regularScheduleSlots.scheduleVersionId, versionIds))
          .orderBy(asc(regularScheduleSlots.dayOfWeek), asc(regularScheduleSlots.startTime))
      : [];

    return versions.map((version) => ({
      ...version,
      slots: slots.filter((slot) => slot.scheduleVersionId === version.id),
    }));
  }

  async createFirstLesson(dto: CreateFirstLessonDto, actor: AuthUser, requestId?: string) {
    const startsAt = new Date(dto.startsAt);
    if (Number.isNaN(startsAt.getTime())) {
      throw new BadRequestException({ code: "INVALID_FIRST_LESSON_START", message: "Invalid first lesson start time" });
    }
    if (startsAt.getTime() <= Date.now()) {
      throw new BadRequestException({ code: "FIRST_LESSON_MUST_BE_FUTURE", message: "First lesson must be scheduled in the future" });
    }

    const durationMinutes = 60;
    const endsAt = addMinutes(startsAt, durationMinutes);
    const local = formatInSchoolTimeZone(startsAt);

    try {
      return await this.db.transaction(async (tx) => {
        const [student] = await tx
          .select({ id: students.id, firstName: students.firstName, lastName: students.lastName })
          .from(students)
          .where(eq(students.id, dto.studentId))
          .limit(1);
        if (!student) {
          throw new NotFoundException({ code: "STUDENT_NOT_FOUND", message: "Student not found" });
        }

        const [teacherSubject] = await tx
          .select({ teacherId: teacherSubjects.teacherId })
          .from(teacherSubjects)
          .innerJoin(teacherProfiles, eq(teacherSubjects.teacherId, teacherProfiles.userId))
          .innerJoin(subjects, eq(teacherSubjects.subjectId, subjects.id))
          .where(
            and(
              eq(teacherSubjects.teacherId, dto.teacherId),
              eq(teacherSubjects.subjectId, dto.subjectId),
              eq(teacherSubjects.isActive, true),
              eq(teacherProfiles.status, "ACTIVE"),
              eq(subjects.status, "ACTIVE"),
            ),
          )
          .limit(1);
        if (!teacherSubject) {
          throw new ConflictException({
            code: "TEACHER_SUBJECT_NOT_AVAILABLE",
            message: "Teacher is not active for this subject",
          });
        }

        const availability = await this.loadAvailabilitySnapshot(tx, dto.teacherId, local.date, local.date);
        if (!this.isTeacherAvailable(availability, local.date, isoDayOfWeek(local.date), local.time, durationMinutes)) {
          throw new ConflictException({
            code: "TEACHER_NOT_AVAILABLE",
            message: "Teacher is not available at the requested first-lesson time",
          });
        }

        const [session] = await tx
          .insert(liveSessions)
          .values({
            studentId: dto.studentId,
            enrollmentId: null,
            subjectId: dto.subjectId,
            primaryTeacherId: dto.teacherId,
            actualTeacherId: dto.teacherId,
            sessionType: "FIRST",
            fundingStatus: "BOOKED",
            status: "SCHEDULED",
            startsAt,
            endsAt,
            createdBy: actor.id,
          })
          .returning();

        await this.audit.record(
          {
            actorUserId: actor.id,
            actorRoleCode: actor.roles[0],
            action: "CREATE_FIRST_LESSON",
            entityType: "LiveSession",
            entityId: session.id,
            requestId,
            afterData: {
              studentId: dto.studentId,
              subjectId: dto.subjectId,
              teacherId: dto.teacherId,
              startsAt,
              endsAt,
              fundingStatus: "BOOKED",
            },
          },
          tx,
        );

        const notificationContext = await this.loadStudentNotificationContext(tx, dto.studentId);
        await this.outbox.publishNotification(
          {
            aggregateType: "LiveSession",
            aggregateId: session.id,
            recipientUserIds: [dto.teacherId],
            eventType: "FIRST_LESSON_ASSIGNED",
            title: "Призначено новий перший урок",
            body: `${student.firstName} ${student.lastName} · ${notificationContext.parentFullName ?? "Батьки"} · ${notificationContext.parentPhone ?? "контакт не вказано"} · ${startsAt.toISOString()}`,
            actionPath: `/teacher/schedule`,
            entityType: "LiveSession",
            entityId: session.id,
            data: { studentId: dto.studentId, subjectId: dto.subjectId, startsAt: startsAt.toISOString() },
          },
          tx,
        );

        return session;
      });
    } catch (error) {
      if (isPgExclusionViolation(error)) {
        const constraint = pgConstraint(error);
        if (constraint === "teacher_session_no_overlap") {
          throw new ConflictException({ code: "TEACHER_SESSION_CONFLICT", message: "Teacher already has a lesson in this time range" });
        }
        if (constraint === "student_session_no_overlap") {
          throw new ConflictException({ code: "STUDENT_SESSION_CONFLICT", message: "Student already has a lesson in this time range" });
        }
      }
      throw error;
    }
  }

  async rescheduleSession(sessionId: string, dto: RescheduleSessionDto, actor: AuthUser, requestId?: string) {
    try {
      return await this.db.transaction(async (tx) => {
        const locked = await tx.execute(sql`
          SELECT id, student_id, subject_id, enrollment_id, primary_teacher_id, actual_teacher_id,
                 session_type, starts_at, ends_at, status, funding_status
          FROM live_sessions
          WHERE id = ${sessionId}
          FOR UPDATE
        `);

        if (!locked.rowCount) {
          throw new NotFoundException({ code: "SESSION_NOT_FOUND", message: "Lesson not found" });
        }

        const session = locked.rows[0] as {
          id: string;
          student_id: string;
          subject_id: string;
          enrollment_id: string | null;
          primary_teacher_id: string;
          actual_teacher_id: string;
          session_type: "FIRST" | "REGULAR";
          starts_at: Date;
          ends_at: Date;
          status: string;
          funding_status: string;
        };

        if (session.status !== "SCHEDULED") {
          throw new ConflictException({ code: "SESSION_NOT_SCHEDULED", message: "Only scheduled lessons can be moved" });
        }

        await this.assertCanRescheduleSession(tx, session, actor);

        let requestedStart: Date;
        let consumedPlaceholderId: string | null = null;

        if (dto.mode === "END_OF_PAID_SEQUENCE") {
          const target = await this.findEndOfSequenceTarget(tx, session);
          requestedStart = target.startsAt;
          consumedPlaceholderId = target.placeholderId;
        } else {
          if (!dto.startsAt) {
            throw new BadRequestException({
              code: "RESCHEDULE_TIME_REQUIRED",
              message: "Choose a new lesson time",
            });
          }
          requestedStart = new Date(dto.startsAt);
          if (Number.isNaN(requestedStart.getTime()) || requestedStart.getTime() <= Date.now()) {
            throw new BadRequestException({
              code: "INVALID_RESCHEDULE_TIME",
              message: "The new lesson time must be in the future",
            });
          }
        }

        const durationMinutes = Math.round((session.ends_at.getTime() - session.starts_at.getTime()) / 60_000);
        const requestedEnd = addMinutes(requestedStart, durationMinutes);
        const local = formatInSchoolTimeZone(requestedStart);
        const availability = await this.loadAvailabilitySnapshot(tx, session.actual_teacher_id, local.date, local.date);
        if (!this.isTeacherAvailable(availability, local.date, isoDayOfWeek(local.date), local.time, durationMinutes)) {
          throw new ConflictException({
            code: "TEACHER_NOT_AVAILABLE",
            message: "Teacher is not available at the requested time",
          });
        }

        if (consumedPlaceholderId) {
          await tx
            .update(liveSessions)
            .set({ status: "CANCELLED", updatedAt: new Date() })
            .where(eq(liveSessions.id, consumedPlaceholderId));
        }

        await tx
          .update(liveSessions)
          .set({ startsAt: requestedStart, endsAt: requestedEnd, updatedAt: new Date() })
          .where(eq(liveSessions.id, sessionId));

        const [reschedule] = await tx
          .insert(sessionReschedules)
          .values({
            sessionId,
            fromStartAt: session.starts_at,
            fromEndAt: session.ends_at,
            toStartAt: requestedStart,
            toEndAt: requestedEnd,
            reason: dto.reason,
            mode: dto.mode,
            comment: dto.comment?.trim() || undefined,
            initiatedBy: actor.id,
          })
          .returning();

        await this.audit.record(
          {
            actorUserId: actor.id,
            actorRoleCode: actor.roles[0],
            action: "RESCHEDULE_SESSION",
            entityType: "LiveSession",
            entityId: sessionId,
            requestId,
            beforeData: { startsAt: session.starts_at, endsAt: session.ends_at },
            afterData: {
              startsAt: requestedStart,
              endsAt: requestedEnd,
              reason: dto.reason,
              mode: dto.mode,
              consumedPlaceholderId,
            },
          },
          tx,
        );

        const notificationContext = await this.loadStudentNotificationContext(tx, session.student_id);
        await this.outbox.publishNotification(
          {
            aggregateType: "LiveSession",
            aggregateId: sessionId,
            recipientUserIds: [session.actual_teacher_id, notificationContext.parentUserId, notificationContext.studentUserId].filter((id): id is string => Boolean(id) && id !== actor.id),
            eventType: "LESSON_RESCHEDULED",
            title: "Заняття перенесено",
            body: `${notificationContext.studentFullName} · ${session.starts_at.toISOString()} → ${requestedStart.toISOString()}`,
            actionPath: actor.roles.includes("PARENT") ? `/teacher/schedule` : `/parent`,
            entityType: "LiveSession",
            entityId: sessionId,
            data: { studentId: session.student_id, from: session.starts_at.toISOString(), to: requestedStart.toISOString(), reason: dto.reason, mode: dto.mode },
          },
          tx,
        );

        return reschedule;
      });
    } catch (error) {
      if (isPgExclusionViolation(error)) {
        const constraint = pgConstraint(error);
        if (constraint === "teacher_session_no_overlap") {
          throw new ConflictException({ code: "TEACHER_SESSION_CONFLICT", message: "Teacher already has a lesson in this time range" });
        }
        if (constraint === "student_session_no_overlap") {
          throw new ConflictException({ code: "STUDENT_SESSION_CONFLICT", message: "Student already has a lesson in this time range" });
        }
      }
      throw error;
    }
  }

  async listSubstituteCandidates(sessionId: string, actor: AuthUser) {
    if (!actor.roles.some((role) => PRIVILEGED_ROLES.has(role))) {
      throw new ForbiddenException({
        code: "SUBSTITUTE_LIST_DENIED",
        message: "Only school staff can choose a substitute teacher",
      });
    }

    const sessionResult = await this.db.execute(sql`
      SELECT id, subject_id, primary_teacher_id, actual_teacher_id, starts_at, ends_at, status
      FROM live_sessions
      WHERE id = ${sessionId}
      LIMIT 1
    `);
    if (!sessionResult.rowCount) {
      throw new NotFoundException({ code: "SESSION_NOT_FOUND", message: "Lesson not found" });
    }

    const session = sessionResult.rows[0] as {
      id: string;
      subject_id: string;
      primary_teacher_id: string;
      actual_teacher_id: string;
      starts_at: Date;
      ends_at: Date;
      status: string;
    };
    if (session.status !== "SCHEDULED") {
      throw new ConflictException({
        code: "SESSION_NOT_SCHEDULED",
        message: "Only scheduled lessons can receive a substitute",
      });
    }

    const candidatesResult = await this.db.execute(sql`
      SELECT DISTINCT
        tp.user_id,
        tp.first_name,
        tp.last_name,
        tp.phone,
        tp.zoom_url
      FROM teacher_profiles tp
      JOIN teacher_subjects ts ON ts.teacher_id = tp.user_id
      WHERE ts.subject_id = ${session.subject_id}
        AND ts.is_active = true
        AND tp.status = 'ACTIVE'
        AND tp.archived_at IS NULL
        AND tp.user_id <> ${session.actual_teacher_id}
      ORDER BY tp.last_name, tp.first_name
    `);

    const startsAt = new Date(session.starts_at);
    const endsAt = new Date(session.ends_at);
    const durationMinutes = Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000);
    const local = formatInSchoolTimeZone(startsAt);
    const results: Array<{
      id: string;
      firstName: string;
      lastName: string;
      fullName: string;
      phone: string | null;
      zoomUrl: string | null;
      isPrimaryTeacher: boolean;
    }> = [];

    for (const candidate of candidatesResult.rows as any[]) {
      const snapshot = await this.loadAvailabilitySnapshot(this.db, candidate.user_id, local.date, local.date);
      if (!this.isTeacherAvailable(snapshot, local.date, isoDayOfWeek(local.date), local.time, durationMinutes)) {
        continue;
      }

      const conflict = await this.db.execute(sql`
        SELECT 1
        FROM live_sessions
        WHERE actual_teacher_id = ${candidate.user_id}
          AND id <> ${session.id}
          AND status IN ('SCHEDULED', 'COMPLETED', 'CHARGED_NO_SHOW')
          AND starts_at < ${endsAt}
          AND ends_at > ${startsAt}
        LIMIT 1
      `);
      if (conflict.rowCount) continue;

      results.push({
        id: candidate.user_id,
        firstName: candidate.first_name,
        lastName: candidate.last_name,
        fullName: `${candidate.last_name} ${candidate.first_name}`,
        phone: candidate.phone ?? null,
        zoomUrl: candidate.zoom_url ?? null,
        isPrimaryTeacher: candidate.user_id === session.primary_teacher_id,
      });
    }

    return {
      sessionId,
      startsAt,
      endsAt,
      candidates: results,
    };
  }

  async assignSubstitute(
    sessionId: string,
    dto: AssignSubstituteDto,
    actor: AuthUser,
    requestId?: string,
  ) {
    if (!actor.roles.some((role) => PRIVILEGED_ROLES.has(role))) {
      throw new ForbiddenException({
        code: "SUBSTITUTE_ASSIGN_DENIED",
        message: "Only school staff can assign a substitute",
      });
    }

    try {
      return await this.db.transaction(async (tx) => {
        const locked = await tx.execute(sql`
          SELECT id, student_id, subject_id, primary_teacher_id, actual_teacher_id,
                 starts_at, ends_at, status
          FROM live_sessions
          WHERE id = ${sessionId}
          FOR UPDATE
        `);
        if (!locked.rowCount) {
          throw new NotFoundException({ code: "SESSION_NOT_FOUND", message: "Lesson not found" });
        }

        const session = locked.rows[0] as any;
        if (session.status !== "SCHEDULED") {
          throw new ConflictException({
            code: "SESSION_NOT_SCHEDULED",
            message: "Only scheduled lessons can receive a substitute",
          });
        }
        if (session.actual_teacher_id === dto.teacherId) {
          throw new ConflictException({
            code: "SUBSTITUTE_ALREADY_ASSIGNED",
            message: "This teacher is already assigned to the lesson",
          });
        }

        const teacher = await tx.execute(sql`
          SELECT tp.user_id, tp.first_name, tp.last_name, tp.status
          FROM teacher_profiles tp
          JOIN teacher_subjects ts ON ts.teacher_id = tp.user_id
          WHERE tp.user_id = ${dto.teacherId}
            AND tp.status = 'ACTIVE'
            AND tp.archived_at IS NULL
            AND ts.subject_id = ${session.subject_id}
            AND ts.is_active = true
          LIMIT 1
        `);
        if (!teacher.rowCount) {
          throw new ConflictException({
            code: "TEACHER_SUBJECT_MISMATCH",
            message: "Substitute is not an active teacher of this subject",
          });
        }

        const duration = Math.round(
          (new Date(session.ends_at).getTime() - new Date(session.starts_at).getTime()) / 60_000,
        );
        const local = formatInSchoolTimeZone(new Date(session.starts_at));
        const snapshot = await this.loadAvailabilitySnapshot(tx, dto.teacherId, local.date, local.date);
        if (!this.isTeacherAvailable(snapshot, local.date, isoDayOfWeek(local.date), local.time, duration)) {
          throw new ConflictException({
            code: "TEACHER_NOT_AVAILABLE",
            message: "Substitute is not available for this time",
          });
        }

        const previousActualTeacherId = session.actual_teacher_id as string;
        await tx.execute(sql`
          UPDATE live_sessions
          SET actual_teacher_id = ${dto.teacherId}, updated_at = now()
          WHERE id = ${sessionId}
        `);

        const ctx = await this.loadStudentNotificationContext(tx, session.student_id);
        const candidate = teacher.rows[0] as any;
        const body = `${ctx.studentFullName} · ${local.date} ${local.time} · ${candidate.last_name} ${candidate.first_name}`;
        await this.outbox.publishNotification(
          {
            aggregateType: "LiveSession",
            aggregateId: sessionId,
            recipientUserIds: [dto.teacherId],
            eventType: "SUBSTITUTE_ASSIGNED",
            title: "Призначено заняття на заміну",
            body,
            actionPath: "/teacher",
            entityType: "LiveSession",
            entityId: sessionId,
            data: { sessionId, studentId: session.student_id, primaryTeacherId: session.primary_teacher_id },
          },
          tx,
        );

        if (ctx.parentUserId) {
          await this.outbox.publishNotification(
            {
              aggregateType: "LiveSession",
              aggregateId: sessionId,
              recipientUserIds: [ctx.parentUserId],
              eventType: "SUBSTITUTE_ASSIGNED",
              title: "На занятті буде заміна викладача",
              body,
              actionPath: "/parent/schedule",
              entityType: "LiveSession",
              entityId: sessionId,
              data: { sessionId, substituteTeacherId: dto.teacherId },
            },
            tx,
          );
        }
        if (ctx.studentUserId) {
          await this.outbox.publishNotification(
            {
              aggregateType: "LiveSession",
              aggregateId: sessionId,
              recipientUserIds: [ctx.studentUserId],
              eventType: "SUBSTITUTE_ASSIGNED",
              title: "На занятті буде заміна викладача",
              body,
              actionPath: "/student/schedule",
              entityType: "LiveSession",
              entityId: sessionId,
              data: { sessionId, substituteTeacherId: dto.teacherId },
            },
            tx,
          );
        }

        await this.audit.record(
          {
            actorUserId: actor.id,
            actorRoleCode: actor.roles[0],
            action: "ASSIGN_SUBSTITUTE",
            entityType: "LiveSession",
            entityId: sessionId,
            beforeData: { actualTeacherId: previousActualTeacherId },
            afterData: { actualTeacherId: dto.teacherId },
            requestId,
          },
          tx,
        );

        return {
          sessionId,
          primaryTeacherId: session.primary_teacher_id,
          previousActualTeacherId,
          actualTeacherId: dto.teacherId,
        };
      });
    } catch (error) {
      if (isPgExclusionViolation(error)) {
        throw new ConflictException({
          code: "TEACHER_SESSION_CONFLICT",
          message: "Substitute already has a lesson in this time range",
        });
      }
      throw error;
    }
  }

  async pauseEnrollment(enrollmentId:string,dto:StudentPauseDto,actor:AuthUser,requestId?:string){
    if(dto.returnsOn<=dto.startsOn) throw new BadRequestException({code:"INVALID_PAUSE_DATES",message:"Return date must be after pause start"});
    return this.db.transaction(async tx=>{
      const e=await tx.execute(sql`SELECT id,student_id FROM student_subject_enrollments WHERE id=${enrollmentId} FOR UPDATE`); if(!e.rowCount) throw new NotFoundException({code:"ENROLLMENT_NOT_FOUND",message:"Enrollment not found"});
      const pause=await tx.execute(sql`INSERT INTO student_enrollment_pauses(enrollment_id,starts_on,returns_on,created_by) VALUES(${enrollmentId},${dto.startsOn},${dto.returnsOn},${actor.id}) RETURNING *`); const affected=await tx.execute(sql`SELECT id FROM live_sessions WHERE enrollment_id=${enrollmentId} AND status='SCHEDULED' AND occurrence_date>=${dto.startsOn} AND occurrence_date<${dto.returnsOn} FOR UPDATE`);
      await tx.execute(sql`UPDATE session_credit_reservations r SET status='RELEASED',updated_at=now() FROM live_sessions s WHERE s.id=r.session_id AND s.enrollment_id=${enrollmentId} AND s.occurrence_date>=${dto.startsOn} AND s.occurrence_date<${dto.returnsOn} AND r.status='ACTIVE'`);
      await tx.execute(sql`UPDATE live_sessions SET status='CANCELLED',funding_status='BOOKED',updated_at=now() WHERE enrollment_id=${enrollmentId} AND status='SCHEDULED' AND occurrence_date>=${dto.startsOn} AND occurrence_date<${dto.returnsOn}`);
      const refreshed=await this.fundingMaterializer.refreshEnrollment(enrollmentId,actor.id,tx); await this.audit.record({actorUserId:actor.id,actorRoleCode:actor.roles[0],action:"PAUSE_STUDENT_ENROLLMENT",entityType:"StudentSubjectEnrollment",entityId:enrollmentId,afterData:{startsOn:dto.startsOn,returnsOn:dto.returnsOn,affectedLessons:affected.rowCount},requestId},tx as any); return {pause:pause.rows[0],affectedLessons:affected.rowCount,refreshed};
    });
  }

  async getSessionDetail(sessionId: string, actor: AuthUser) {
    const result = await this.db.execute(sql`
      SELECT
        ls.id, ls.student_id, ls.enrollment_id, ls.subject_id,
        ls.primary_teacher_id, ls.actual_teacher_id,
        ls.session_type, ls.funding_status, ls.status,
        ls.starts_at, ls.ends_at, ls.topic_title, ls.homework_assigned,
        st.first_name AS student_first_name, st.last_name AS student_last_name,
        st.grade_level, st.family_id,
        sub.name AS subject_name,
        pt.first_name AS primary_teacher_first_name, pt.last_name AS primary_teacher_last_name,
        at.first_name AS actual_teacher_first_name, at.last_name AS actual_teacher_last_name,
        at.phone AS actual_teacher_phone, at.zoom_url,
        pp.user_id AS parent_user_id, pp.first_name AS parent_first_name,
        pp.last_name AS parent_last_name, pp.phone AS parent_phone,
        st.user_id AS student_user_id,
        EXISTS(
          SELECT 1 FROM progress_report_requests rr
          WHERE rr.target_session_id = ls.id AND rr.status = 'PENDING'
        ) AS needs_report,
        (
          COALESCE((SELECT SUM(g.credits_granted) FROM lesson_credit_grants g WHERE g.enrollment_id = ls.enrollment_id), 0)
          - COALESCE((SELECT SUM(d.credits_debited) FROM lesson_credit_debits d WHERE d.enrollment_id = ls.enrollment_id), 0)
        )::int AS balance_credits
      FROM live_sessions ls
      JOIN students st ON st.id = ls.student_id
      JOIN subjects sub ON sub.id = ls.subject_id
      JOIN teacher_profiles pt ON pt.user_id = ls.primary_teacher_id
      JOIN teacher_profiles at ON at.user_id = ls.actual_teacher_id
      LEFT JOIN parent_profiles pp ON pp.family_id = st.family_id
      WHERE ls.id = ${sessionId}
      LIMIT 1
    `);
    if (!result.rowCount) throw new NotFoundException({ code: "SESSION_NOT_FOUND", message: "Lesson not found" });
    const row = result.rows[0] as any;

    const privileged = actor.roles.some((role) => PRIVILEGED_ROLES.has(role));
    let allowed = privileged;
    if (actor.roles.includes("TEACHER")) allowed = allowed || row.actual_teacher_id === actor.id || row.primary_teacher_id === actor.id;
    if (actor.roles.includes("PARENT")) allowed = allowed || row.parent_user_id === actor.id;
    if (actor.roles.includes("STUDENT")) allowed = allowed || row.student_user_id === actor.id;
    if (!allowed) throw new ForbiddenException({ code: "SESSION_SCOPE_DENIED", message: "You cannot view this lesson" });

    const now = Date.now();
    const teacherMarkDeadlineHours = await numberSchoolSetting(this.db, "teacher_mark_deadline_hours", 48);
    const parentRescheduleCutoffMinutes = await numberSchoolSetting(this.db, "parent_reschedule_cutoff_minutes", 120);
    const startsAt = new Date(row.starts_at);
    const endsAt = new Date(row.ends_at);
    const isActualTeacher = actor.roles.includes("TEACHER") && row.actual_teacher_id === actor.id;
    const canMarkByPermission = actor.permissions.includes("lesson.mark");
    const withinTeacherWindow = now >= endsAt.getTime() && now <= endsAt.getTime() + teacherMarkDeadlineHours * 60 * 60 * 1000;
    const canMark = row.status === "SCHEDULED" && row.funding_status === "PAID" && canMarkByPermission && (privileged || (isActualTeacher && withinTeacherWindow));
    const canReschedule = row.status === "SCHEDULED" && actor.permissions.includes("lesson.reschedule") && (!actor.roles.includes("PARENT") || startsAt.getTime() - now >= parentRescheduleCutoffMinutes * 60 * 1000);

    return {
      id: row.id,
      student: { id: row.student_id, firstName: row.student_first_name, lastName: row.student_last_name, gradeLevel: row.grade_level },
      subject: { id: row.subject_id, name: row.subject_name },
      enrollmentId: row.enrollment_id,
      primaryTeacher: { id: row.primary_teacher_id, firstName: row.primary_teacher_first_name, lastName: row.primary_teacher_last_name },
      actualTeacher: { id: row.actual_teacher_id, firstName: row.actual_teacher_first_name, lastName: row.actual_teacher_last_name, phone: row.actual_teacher_phone, zoomUrl: row.zoom_url },
      parent: row.parent_user_id && (actor.roles.includes("TEACHER") || privileged) ? { userId: row.parent_user_id, firstName: row.parent_first_name, lastName: row.parent_last_name, phone: row.parent_phone } : null,
      sessionType: row.session_type,
      fundingStatus: row.funding_status,
      status: row.status,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      topicTitle: row.topic_title,
      homeworkAssigned: row.homework_assigned,
      needsReport: Boolean(row.needs_report),
      balanceLessonUnits: row.enrollment_id ? Number(row.balance_credits ?? 0) / 2 : null,
      capabilities: {
        canMark,
        canReschedule,
        canReportIncident: row.status === "SCHEDULED" && actor.permissions.includes("lesson.incident.record") && (privileged || isActualTeacher),
        canAssignSubstitute: row.status === "SCHEDULED" && privileged,
      },
    };
  }

  private async loadStudentNotificationContext(executor: any, studentId: string) {
    const result = await executor.execute(sql`
      SELECT
        st.user_id AS student_user_id,
        st.first_name AS student_first_name,
        st.last_name AS student_last_name,
        pp.user_id AS parent_user_id,
        pp.first_name AS parent_first_name,
        pp.last_name AS parent_last_name,
        pp.phone AS parent_phone
      FROM students st
      LEFT JOIN parent_profiles pp ON pp.family_id = st.family_id
      WHERE st.id = ${studentId}
      LIMIT 1
    `);
    if (!result.rowCount) throw new NotFoundException({ code: "STUDENT_NOT_FOUND", message: "Student not found" });
    const row = result.rows[0] as any;
    return {
      studentUserId: row.student_user_id as string | null,
      studentFullName: `${row.student_first_name} ${row.student_last_name}`,
      parentUserId: row.parent_user_id as string | null,
      parentFullName: row.parent_user_id ? `${row.parent_first_name} ${row.parent_last_name}` : null,
      parentPhone: row.parent_phone as string | null,
    };
  }

}
