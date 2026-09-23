import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  teacherAvailabilityExceptionWindows,
  teacherAvailabilityExceptions,
  teacherAvailabilityTemplates,
  teacherAvailabilityWindows,
  teacherProfiles,
  teacherVacationRequests,
} from "@school/db";
import type { Database } from "@school/db";
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database/database.constants";
import { availabilitySeasonForDateSetting } from "../../common/settings/school-settings";
import {
  addDaysToDateOnly,
  addMinutes,
  isoDayOfWeek,
  minutesSinceMidnight,
  schoolLocalDateTimeToUtc,
  todayInSchoolTimeZone,
} from "../../common/time/kyiv-time";
import type { AuthUser } from "../auth/types";
import { AuditService } from "../audit/audit.service";
import { OutboxService } from "../audit/outbox.service";
import type { MatchTeachersDto } from "./dto/match-teachers.dto";
import type { SetTeacherAvailabilityDto } from "./dto/set-teacher-availability.dto";
import type { SetAvailabilityExceptionDto } from "./dto/set-availability-exception.dto";
import type { CreateVacationRequestDto, ReviewVacationDto } from "./dto/vacation.dto";

const PRIVILEGED_ROLES = new Set(["ADMIN", "MANAGER", "SUPPORT_MANAGER"]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type AvailabilityWindow = { startTime: string; endTime: string };

@Injectable()
export class AvailabilityService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  private assertCanAccessTeacher(teacherId: string, actor: AuthUser) {
    if (actor.id === teacherId) return;
    if (actor.roles.some((role) => PRIVILEGED_ROLES.has(role))) return;

    throw new ForbiddenException({
      code: "TEACHER_AVAILABILITY_SCOPE_DENIED",
      message: "You can only access your own availability",
    });
  }

  private assertPrivileged(actor: AuthUser) {
    if (!actor.roles.some((role) => PRIVILEGED_ROLES.has(role))) {
      throw new ForbiddenException({
        code: "TEACHER_OPERATIONS_DENIED",
        message: "Only school staff can perform this operation",
      });
    }
  }

  private windowCovers(windows: AvailabilityWindow[], startTime: string, durationMinutes: number) {
    const start = minutesSinceMidnight(startTime);
    const end = start + durationMinutes;
    return windows.some((window) => {
      const windowStart = minutesSinceMidnight(window.startTime);
      const windowEnd = minutesSinceMidnight(window.endTime);
      return start >= windowStart && end <= windowEnd;
    });
  }

  private validateWindows(dto: SetTeacherAvailabilityDto) {
    const byDay = new Map<number, Array<{ start: number; end: number }>>();

    for (const window of dto.windows) {
      const start = minutesSinceMidnight(window.startTime);
      const end = minutesSinceMidnight(window.endTime);
      if (end <= start) {
        throw new BadRequestException({
          code: "INVALID_AVAILABILITY_WINDOW",
          message: "Availability end time must be after start time",
        });
      }

      const existing = byDay.get(window.dayOfWeek) ?? [];
      if (existing.some((item) => start < item.end && end > item.start)) {
        throw new BadRequestException({
          code: "OVERLAPPING_AVAILABILITY_WINDOWS",
          message: "Availability windows cannot overlap on the same day",
        });
      }
      existing.push({ start, end });
      byDay.set(window.dayOfWeek, existing);
    }
  }

  private validateExceptionWindows(dto: SetAvailabilityExceptionDto) {
    if ((dto.isUnavailableAllDay ?? false) && dto.windows?.length) {
      throw new BadRequestException({
        code: "INVALID_EXCEPTION",
        message: "All-day unavailability cannot have available windows",
      });
    }

    const intervals: Array<{ start: number; end: number }> = [];
    for (const window of dto.windows ?? []) {
      const start = minutesSinceMidnight(window.startTime);
      const end = minutesSinceMidnight(window.endTime);
      if (end <= start) {
        throw new BadRequestException({
          code: "INVALID_EXCEPTION_WINDOW",
          message: "Exception end must be after start",
        });
      }
      if (intervals.some((item) => start < item.end && end > item.start)) {
        throw new BadRequestException({
          code: "OVERLAPPING_EXCEPTION_WINDOWS",
          message: "Exception windows cannot overlap",
        });
      }
      intervals.push({ start, end });
    }
  }

  private validateMatchSlots(dto: MatchTeachersDto) {
    const byDay = new Map<number, Array<{ start: number; end: number }>>();
    for (const slot of dto.slots) {
      const start = minutesSinceMidnight(slot.startTime);
      const end = start + slot.durationMinutes;
      const existing = byDay.get(slot.dayOfWeek) ?? [];
      if (existing.some((item) => start < item.end && end > item.start)) {
        throw new BadRequestException({
          code: "OVERLAPPING_REQUESTED_SCHEDULE",
          message: "Requested regular schedule contains overlapping slots",
        });
      }
      existing.push({ start, end });
      byDay.set(slot.dayOfWeek, existing);
    }
  }

  async setTemplate(
    teacherId: string,
    dto: SetTeacherAvailabilityDto,
    actor: AuthUser,
    requestId?: string,
  ) {
    this.assertCanAccessTeacher(teacherId, actor);
    this.validateWindows(dto);

    const [teacher] = await this.db
      .select({ id: teacherProfiles.userId, archivedAt: teacherProfiles.archivedAt })
      .from(teacherProfiles)
      .where(eq(teacherProfiles.userId, teacherId))
      .limit(1);

    if (!teacher || teacher.archivedAt) {
      throw new NotFoundException({ code: "TEACHER_NOT_FOUND", message: "Teacher not found" });
    }

    return this.db.transaction(async (tx) => {
      const [template] = await tx
        .insert(teacherAvailabilityTemplates)
        .values({ teacherId, season: dto.season, isActive: true })
        .onConflictDoUpdate({
          target: [teacherAvailabilityTemplates.teacherId, teacherAvailabilityTemplates.season],
          set: { isActive: true, updatedAt: new Date() },
        })
        .returning();

      const before = await tx
        .select({
          dayOfWeek: teacherAvailabilityWindows.dayOfWeek,
          startTime: teacherAvailabilityWindows.startTime,
          endTime: teacherAvailabilityWindows.endTime,
        })
        .from(teacherAvailabilityWindows)
        .where(eq(teacherAvailabilityWindows.templateId, template.id))
        .orderBy(asc(teacherAvailabilityWindows.dayOfWeek), asc(teacherAvailabilityWindows.startTime));

      await tx.delete(teacherAvailabilityWindows).where(eq(teacherAvailabilityWindows.templateId, template.id));

      if (dto.windows.length) {
        await tx.insert(teacherAvailabilityWindows).values(
          dto.windows.map((window) => ({
            templateId: template.id,
            dayOfWeek: window.dayOfWeek,
            startTime: window.startTime,
            endTime: window.endTime,
          })),
        );
      }

      await this.audit.record(
        {
          actorUserId: actor.id,
          actorRoleCode: actor.roles[0],
          action: "SET_TEACHER_AVAILABILITY",
          entityType: "TeacherAvailabilityTemplate",
          entityId: template.id,
          requestId,
          beforeData: { teacherId, season: dto.season, windows: before },
          afterData: { teacherId, season: dto.season, windows: dto.windows },
        },
        tx,
      );

      return { id: template.id, teacherId, season: dto.season, windows: dto.windows };
    });
  }

  async setException(
    teacherId: string,
    dto: SetAvailabilityExceptionDto,
    actor: AuthUser,
    requestId?: string,
  ) {
    this.assertCanAccessTeacher(teacherId, actor);
    this.validateExceptionWindows(dto);

    return this.db.transaction(async (tx) => {
      const old = await tx.execute(sql`
        SELECT e.*,
          COALESCE(jsonb_agg(jsonb_build_object('startTime', w.start_time, 'endTime', w.end_time))
            FILTER (WHERE w.id IS NOT NULL), '[]'::jsonb) AS windows
        FROM teacher_availability_exceptions e
        LEFT JOIN teacher_availability_exception_windows w ON w.exception_id = e.id
        WHERE e.teacher_id = ${teacherId} AND e.exception_date = ${dto.date}
        GROUP BY e.id
      `);

      const result = await tx.execute(sql`
        INSERT INTO teacher_availability_exceptions(
          teacher_id, exception_date, is_unavailable_all_day, created_by, updated_at
        )
        VALUES(${teacherId}, ${dto.date}, ${dto.isUnavailableAllDay ?? false}, ${actor.id}, now())
        ON CONFLICT(teacher_id, exception_date)
        DO UPDATE SET
          is_unavailable_all_day = EXCLUDED.is_unavailable_all_day,
          created_by = EXCLUDED.created_by,
          updated_at = now()
        RETURNING *
      `);
      const exception = result.rows[0] as any;

      await tx.execute(sql`DELETE FROM teacher_availability_exception_windows WHERE exception_id = ${exception.id}`);
      for (const window of dto.windows ?? []) {
        await tx.execute(sql`
          INSERT INTO teacher_availability_exception_windows(exception_id, start_time, end_time)
          VALUES(${exception.id}, ${window.startTime}, ${window.endTime})
        `);
      }

      await this.audit.record(
        {
          actorUserId: actor.id,
          actorRoleCode: actor.roles[0],
          action: "SET_TEACHER_AVAILABILITY_EXCEPTION",
          entityType: "TeacherAvailabilityException",
          entityId: exception.id,
          beforeData: old.rows[0],
          afterData: { ...exception, windows: dto.windows ?? [] },
          requestId,
        },
        tx as any,
      );

      return { ...exception, windows: dto.windows ?? [] };
    });
  }

  async deleteException(teacherId: string, date: string, actor: AuthUser, requestId?: string) {
    this.assertCanAccessTeacher(teacherId, actor);
    if (!DATE_PATTERN.test(date)) {
      throw new BadRequestException({ code: "INVALID_EXCEPTION_DATE", message: "Expected YYYY-MM-DD" });
    }

    return this.db.transaction(async (tx) => {
      const existing = await tx.execute(sql`
        SELECT e.*,
          COALESCE(jsonb_agg(jsonb_build_object('startTime', w.start_time, 'endTime', w.end_time))
            FILTER (WHERE w.id IS NOT NULL), '[]'::jsonb) AS windows
        FROM teacher_availability_exceptions e
        LEFT JOIN teacher_availability_exception_windows w ON w.exception_id = e.id
        WHERE e.teacher_id = ${teacherId} AND e.exception_date = ${date}
        GROUP BY e.id
      `);
      if (!existing.rowCount) {
        throw new NotFoundException({ code: "AVAILABILITY_EXCEPTION_NOT_FOUND", message: "Availability exception not found" });
      }
      const before = existing.rows[0] as any;
      await tx.execute(sql`DELETE FROM teacher_availability_exceptions WHERE id = ${before.id}`);
      await this.audit.record(
        {
          actorUserId: actor.id,
          actorRoleCode: actor.roles[0],
          action: "DELETE_TEACHER_AVAILABILITY_EXCEPTION",
          entityType: "TeacherAvailabilityException",
          entityId: before.id,
          beforeData: before,
          requestId,
        },
        tx as any,
      );
      return { deleted: true, date };
    });
  }

  async matchTeachers(dto: MatchTeachersDto, actor: AuthUser) {
    this.assertPrivileged(actor);
    this.validateMatchSlots(dto);

    const candidates = await this.db.execute(sql`
      SELECT DISTINCT
        tp.user_id, tp.first_name, tp.last_name, tp.phone, tp.zoom_url
      FROM teacher_profiles tp
      JOIN teacher_subjects ts ON ts.teacher_id = tp.user_id
      WHERE ts.subject_id = ${dto.subjectId}
        AND ts.is_active = true
        AND tp.status = 'ACTIVE'
        AND tp.archived_at IS NULL
      ORDER BY tp.last_name, tp.first_name
    `);

    const today = todayInSchoolTimeZone();
    const fromDate = dto.effectiveFrom < today ? today : dto.effectiveFrom;
    const toDate = addDaysToDateOnly(fromDate, 27);
    const rangeStart = schoolLocalDateTimeToUtc(fromDate, "00:00");
    const rangeEnd = schoolLocalDateTimeToUtc(addDaysToDateOnly(toDate, 1), "00:00");
    const requestedSeason = await availabilitySeasonForDateSetting(this.db, dto.effectiveFrom);

    const results: any[] = [];
    for (const teacher of candidates.rows as any[]) {
      const availability = await this.getTeacherAvailability(teacher.user_id, actor);
      const template = availability.templates.find((item: any) => item.season === requestedSeason && item.isActive);
      const templateWindows = (template?.windows ?? []) as Array<{ dayOfWeek: number; startTime: string; endTime: string }>;

      const busyResult = await this.db.execute(sql`
        SELECT starts_at, ends_at
        FROM live_sessions
        WHERE actual_teacher_id = ${teacher.user_id}
          AND status = 'SCHEDULED'
          AND starts_at < ${rangeEnd}
          AND ends_at > ${rangeStart}
        ORDER BY starts_at
      `);
      const busy = (busyResult.rows as any[]).map((row) => ({
        startsAt: new Date(row.starts_at),
        endsAt: new Date(row.ends_at),
      }));

      const slotResults = dto.slots.map((slot) => {
        const dayWindows = templateWindows
          .filter((window) => Number(window.dayOfWeek) === slot.dayOfWeek)
          .map((window) => ({ startTime: String(window.startTime), endTime: String(window.endTime) }));
        const templateCovered = this.windowCovers(dayWindows, slot.startTime, slot.durationMinutes);
        const conflicts: Array<{ date: string; type: "VACATION" | "EXCEPTION" | "BUSY" }> = [];

        if (templateCovered) {
          for (let offset = 0; offset < 28; offset += 1) {
            const date = addDaysToDateOnly(fromDate, offset);
            if (isoDayOfWeek(date) !== slot.dayOfWeek) continue;

            const vacation = (availability.vacations ?? []).find((item: any) =>
              item.status === "APPROVED" && item.startsOn <= date && item.endsOn >= date,
            );
            if (vacation) {
              conflicts.push({ date, type: "VACATION" });
              continue;
            }

            const exception = (availability.exceptions ?? []).find((item: any) => item.date === date);
            if (exception) {
              const exceptionWindows = (exception.windows ?? []).map((window: any) => ({
                startTime: String(window.startTime),
                endTime: String(window.endTime),
              }));
              if (exception.isUnavailableAllDay || !this.windowCovers(exceptionWindows, slot.startTime, slot.durationMinutes)) {
                conflicts.push({ date, type: "EXCEPTION" });
                continue;
              }
            }

            const startsAt = schoolLocalDateTimeToUtc(date, slot.startTime);
            const endsAt = addMinutes(startsAt, slot.durationMinutes);
            if (busy.some((item) => startsAt < item.endsAt && endsAt > item.startsAt)) {
              conflicts.push({ date, type: "BUSY" });
            }
          }
        }

        return {
          ...slot,
          templateCovered,
          conflicts: conflicts.slice(0, 8),
          conflictCount: conflicts.length,
        };
      });

      const matchedSlots = slotResults.filter((slot) => slot.templateCovered).length;
      const conflictCount = slotResults.reduce((sum, slot) => sum + slot.conflictCount, 0);
      const matchType = matchedSlots === dto.slots.length ? "FULL" : matchedSlots > 0 ? "PARTIAL" : "NONE";
      const selectable = matchType === "FULL" && conflictCount === 0;

      results.push({
        teacherId: teacher.user_id,
        firstName: teacher.first_name,
        lastName: teacher.last_name,
        phone: teacher.phone,
        zoomUrl: teacher.zoom_url,
        matchType,
        selectable,
        matchedSlots,
        requestedSlots: dto.slots.length,
        conflictCount,
        slots: slotResults,
      });
    }

    const rank = (item: any) => {
      if (item.selectable) return 0;
      if (item.matchType === "FULL") return 1;
      if (item.matchType === "PARTIAL") return 2;
      return 3;
    };
    results.sort((a, b) =>
      rank(a) - rank(b)
      || b.matchedSlots - a.matchedSlots
      || a.conflictCount - b.conflictCount
      || `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, "uk"),
    );

    return {
      subjectId: dto.subjectId,
      effectiveFrom: dto.effectiveFrom,
      season: requestedSeason,
      horizon: { from: fromDate, to: toDate },
      results,
    };
  }

  async createVacationRequest(
    teacherId: string,
    dto: CreateVacationRequestDto,
    actor: AuthUser,
    requestId?: string,
  ) {
    this.assertCanAccessTeacher(teacherId, actor);
    if (dto.endsOn < dto.startsOn) {
      throw new BadRequestException({ code: "INVALID_VACATION_DATES", message: "Vacation end must be on or after start" });
    }
    const result = await this.db.execute(sql`
      INSERT INTO teacher_vacation_requests(teacher_id, starts_on, ends_on, comment, status)
      VALUES(${teacherId}, ${dto.startsOn}, ${dto.endsOn}, ${dto.comment ?? null}, 'PENDING')
      RETURNING *
    `);
    const vacation = result.rows[0] as any;
    await this.audit.record({
      actorUserId: actor.id,
      actorRoleCode: actor.roles[0],
      action: "REQUEST_TEACHER_VACATION",
      entityType: "TeacherVacationRequest",
      entityId: vacation.id,
      afterData: vacation,
      requestId,
    });
    return vacation;
  }

  async reviewVacation(id: string, dto: ReviewVacationDto, actor: AuthUser, requestId?: string) {
    this.assertPrivileged(actor);
    return this.db.transaction(async (tx) => {
      const before = await tx.execute(sql`SELECT * FROM teacher_vacation_requests WHERE id = ${id} FOR UPDATE`);
      if (!before.rowCount) {
        throw new NotFoundException({ code: "VACATION_NOT_FOUND", message: "Vacation request not found" });
      }
      const old = before.rows[0] as any;
      if (old.status !== "PENDING") {
        throw new ConflictException({ code: "VACATION_ALREADY_REVIEWED", message: "Vacation request has already been reviewed" });
      }

      const result = await tx.execute(sql`
        UPDATE teacher_vacation_requests
        SET status = ${dto.status}, reviewed_by = ${actor.id}, reviewed_at = now()
        WHERE id = ${id}
        RETURNING *
      `);
      const vacation = result.rows[0] as any;
      const impacted = await tx.execute(sql`
        SELECT ls.id, ls.student_id, ls.starts_at, ls.ends_at,
               st.first_name, st.last_name,
               pp.user_id AS parent_user_id, st.user_id AS student_user_id
        FROM live_sessions ls
        JOIN students st ON st.id = ls.student_id
        LEFT JOIN parent_profiles pp ON pp.family_id = st.family_id
        WHERE ls.actual_teacher_id = ${vacation.teacher_id}
          AND ls.status = 'SCHEDULED'
          AND (ls.starts_at AT TIME ZONE 'Europe/Kyiv')::date
              BETWEEN ${vacation.starts_on}::date AND ${vacation.ends_on}::date
        ORDER BY ls.starts_at
      `);

      await this.outbox.publishNotification(
        {
          aggregateType: "TeacherVacationRequest",
          aggregateId: id,
          recipientUserIds: [vacation.teacher_id],
          eventType: dto.status === "APPROVED" ? "TEACHER_VACATION_APPROVED" : "TEACHER_VACATION_REJECTED",
          title: dto.status === "APPROVED" ? "Відпустку погоджено" : "Запит на відпустку відхилено",
          body: `${vacation.starts_on} — ${vacation.ends_on}`,
          actionPath: "/teacher/vacations",
          entityType: "TeacherVacationRequest",
          entityId: id,
        },
        tx as any,
      );

      if (dto.status === "APPROVED") {
        const recipients = [...new Set(
          (impacted.rows as any[]).flatMap((item) => [item.parent_user_id, item.student_user_id]).filter(Boolean),
        )] as string[];
        await this.outbox.publishNotification(
          {
            aggregateType: "TeacherVacationRequest",
            aggregateId: id,
            recipientUserIds: recipients,
            eventType: "LESSON_RESCHEDULED",
            title: "Зміни через відпустку викладача",
            body: `Школа опрацює ${impacted.rowCount ?? 0} занять у період ${vacation.starts_on} — ${vacation.ends_on}.`,
            actionPath: "/parent/schedule",
            entityType: "TeacherVacationRequest",
            entityId: id,
          },
          tx as any,
        );
      }

      await this.audit.record(
        {
          actorUserId: actor.id,
          actorRoleCode: actor.roles[0],
          action: "REVIEW_TEACHER_VACATION",
          entityType: "TeacherVacationRequest",
          entityId: id,
          beforeData: old,
          afterData: { ...vacation, reviewComment: dto.comment, impactedLessons: impacted.rowCount },
          requestId,
        },
        tx as any,
      );
      return { vacation, impactedLessons: impacted.rows };
    });
  }

  async listVacationRequests(actor: AuthUser, status = "OPEN") {
    this.assertPrivileged(actor);
    const normalized = status.toUpperCase();
    if (!["OPEN", "ALL", "PENDING", "APPROVED", "REJECTED", "CANCELLED"].includes(normalized)) {
      throw new BadRequestException({ code: "INVALID_VACATION_STATUS", message: "Unknown vacation status" });
    }

    const statusClause = normalized === "ALL"
      ? sql`TRUE`
      : normalized === "OPEN"
        ? sql`(v.status = 'PENDING' OR (v.status = 'APPROVED' AND v.ends_on >= (now() AT TIME ZONE 'Europe/Kyiv')::date))`
        : sql`v.status = ${normalized}`;

    const result = await this.db.execute(sql`
      SELECT
        v.id, v.teacher_id, v.starts_on, v.ends_on, v.comment, v.status,
        v.reviewed_by, v.reviewed_at, v.created_at,
        tp.first_name AS teacher_first_name, tp.last_name AS teacher_last_name,
        COUNT(ls.id) FILTER (WHERE ls.id IS NOT NULL)::int AS unresolved_lessons
      FROM teacher_vacation_requests v
      JOIN teacher_profiles tp ON tp.user_id = v.teacher_id
      LEFT JOIN live_sessions ls
        ON ls.actual_teacher_id = v.teacher_id
       AND ls.status = 'SCHEDULED'
       AND (ls.starts_at AT TIME ZONE 'Europe/Kyiv')::date BETWEEN v.starts_on AND v.ends_on
      WHERE ${statusClause}
      GROUP BY v.id, tp.first_name, tp.last_name
      ORDER BY
        CASE v.status WHEN 'PENDING' THEN 0 WHEN 'APPROVED' THEN 1 ELSE 2 END,
        v.starts_on ASC, v.created_at ASC
    `);

    return (result.rows as any[]).map((row) => ({
      id: row.id,
      teacherId: row.teacher_id,
      teacherName: `${row.teacher_last_name} ${row.teacher_first_name}`,
      startsOn: row.starts_on,
      endsOn: row.ends_on,
      comment: row.comment,
      status: row.status,
      reviewedBy: row.reviewed_by,
      reviewedAt: row.reviewed_at,
      createdAt: row.created_at,
      unresolvedLessons: Number(row.unresolved_lessons ?? 0),
    }));
  }

  async getVacationImpact(id: string, actor: AuthUser) {
    this.assertPrivileged(actor);
    const vacationResult = await this.db.execute(sql`
      SELECT v.*, tp.first_name AS teacher_first_name, tp.last_name AS teacher_last_name
      FROM teacher_vacation_requests v
      JOIN teacher_profiles tp ON tp.user_id = v.teacher_id
      WHERE v.id = ${id}
      LIMIT 1
    `);
    if (!vacationResult.rowCount) {
      throw new NotFoundException({ code: "VACATION_NOT_FOUND", message: "Vacation request not found" });
    }
    const vacation = vacationResult.rows[0] as any;

    const impacted = await this.db.execute(sql`
      SELECT
        ls.id, ls.student_id, ls.enrollment_id, ls.subject_id,
        ls.primary_teacher_id, ls.actual_teacher_id, ls.session_type,
        ls.funding_status, ls.starts_at, ls.ends_at,
        st.first_name AS student_first_name, st.last_name AS student_last_name, st.grade_level,
        sub.name AS subject_name
      FROM live_sessions ls
      JOIN students st ON st.id = ls.student_id
      JOIN subjects sub ON sub.id = ls.subject_id
      WHERE ls.actual_teacher_id = ${vacation.teacher_id}
        AND ls.status = 'SCHEDULED'
        AND (ls.starts_at AT TIME ZONE 'Europe/Kyiv')::date BETWEEN ${vacation.starts_on}::date AND ${vacation.ends_on}::date
      ORDER BY ls.starts_at ASC
    `);

    return {
      vacation: {
        id: vacation.id,
        teacherId: vacation.teacher_id,
        teacherName: `${vacation.teacher_last_name} ${vacation.teacher_first_name}`,
        startsOn: vacation.starts_on,
        endsOn: vacation.ends_on,
        comment: vacation.comment,
        status: vacation.status,
        reviewedAt: vacation.reviewed_at,
      },
      unresolvedLessons: (impacted.rows as any[]).map((row) => ({
        id: row.id,
        student: {
          id: row.student_id,
          firstName: row.student_first_name,
          lastName: row.student_last_name,
          gradeLevel: row.grade_level,
        },
        enrollmentId: row.enrollment_id,
        subject: { id: row.subject_id, name: row.subject_name },
        sessionType: row.session_type,
        fundingStatus: row.funding_status,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        primaryTeacherId: row.primary_teacher_id,
        actualTeacherId: row.actual_teacher_id,
        canMoveToEnd: row.session_type === "REGULAR" && Boolean(row.enrollment_id),
      })),
    };
  }

  async getTeacherAvailability(teacherId: string, actor: AuthUser) {
    this.assertCanAccessTeacher(teacherId, actor);

    const [teacher] = await this.db
      .select({ id: teacherProfiles.userId })
      .from(teacherProfiles)
      .where(eq(teacherProfiles.userId, teacherId))
      .limit(1);
    if (!teacher) {
      throw new NotFoundException({ code: "TEACHER_NOT_FOUND", message: "Teacher not found" });
    }

    const templateRows = await this.db
      .select({
        templateId: teacherAvailabilityTemplates.id,
        season: teacherAvailabilityTemplates.season,
        isActive: teacherAvailabilityTemplates.isActive,
        dayOfWeek: teacherAvailabilityWindows.dayOfWeek,
        startTime: teacherAvailabilityWindows.startTime,
        endTime: teacherAvailabilityWindows.endTime,
      })
      .from(teacherAvailabilityTemplates)
      .leftJoin(teacherAvailabilityWindows, eq(teacherAvailabilityTemplates.id, teacherAvailabilityWindows.templateId))
      .where(eq(teacherAvailabilityTemplates.teacherId, teacherId))
      .orderBy(
        asc(teacherAvailabilityTemplates.season),
        asc(teacherAvailabilityWindows.dayOfWeek),
        asc(teacherAvailabilityWindows.startTime),
      );

    const templates = new Map<string, {
      id: string;
      season: "SCHOOL_YEAR" | "SUMMER";
      isActive: boolean;
      windows: Array<{ dayOfWeek: number; startTime: string; endTime: string }>;
    }>();

    for (const row of templateRows) {
      let template = templates.get(row.templateId);
      if (!template) {
        template = { id: row.templateId, season: row.season, isActive: row.isActive, windows: [] };
        templates.set(row.templateId, template);
      }
      if (row.dayOfWeek !== null && row.startTime && row.endTime) {
        template.windows.push({ dayOfWeek: row.dayOfWeek, startTime: row.startTime, endTime: row.endTime });
      }
    }

    const today = todayInSchoolTimeZone();
    const exceptions = await this.db
      .select({
        id: teacherAvailabilityExceptions.id,
        date: teacherAvailabilityExceptions.exceptionDate,
        isUnavailableAllDay: teacherAvailabilityExceptions.isUnavailableAllDay,
      })
      .from(teacherAvailabilityExceptions)
      .where(and(eq(teacherAvailabilityExceptions.teacherId, teacherId), gte(teacherAvailabilityExceptions.exceptionDate, today)))
      .orderBy(asc(teacherAvailabilityExceptions.exceptionDate));

    const exceptionIds = exceptions.map((item) => item.id);
    const exceptionWindowRows = exceptionIds.length
      ? await this.db
          .select({
            exceptionId: teacherAvailabilityExceptionWindows.exceptionId,
            startTime: teacherAvailabilityExceptionWindows.startTime,
            endTime: teacherAvailabilityExceptionWindows.endTime,
          })
          .from(teacherAvailabilityExceptionWindows)
          .where(inArray(teacherAvailabilityExceptionWindows.exceptionId, exceptionIds))
          .orderBy(asc(teacherAvailabilityExceptionWindows.startTime))
      : [];

    const windowsByException = new Map<string, Array<{ startTime: string; endTime: string }>>();
    for (const row of exceptionWindowRows) {
      const list = windowsByException.get(row.exceptionId) ?? [];
      list.push({ startTime: row.startTime, endTime: row.endTime });
      windowsByException.set(row.exceptionId, list);
    }

    const vacations = await this.db
      .select()
      .from(teacherVacationRequests)
      .where(
        and(
          eq(teacherVacationRequests.teacherId, teacherId),
          gte(teacherVacationRequests.endsOn, today),
          inArray(teacherVacationRequests.status, ["PENDING", "APPROVED"]),
        ),
      )
      .orderBy(asc(teacherVacationRequests.startsOn));

    return {
      teacherId,
      templates: [...templates.values()],
      exceptions: exceptions.map((item) => ({ ...item, windows: windowsByException.get(item.id) ?? [] })),
      vacations,
    };
  }
}
