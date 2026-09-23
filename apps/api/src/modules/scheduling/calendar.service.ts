import { ForbiddenException, Inject, Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import {
  liveSessions,
  parentProfiles,
  progressReportRequests,
  students,
  subjects,
  teacherProfiles,
} from "@school/db";
import type { Database } from "@school/db";
import { and, asc, eq, gte, inArray, lt, notInArray, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database/database.constants";
import { addDaysToDateOnly, schoolLocalDateTimeToUtc } from "../../common/time/kyiv-time";
import type { AuthUser } from "../auth/types";
import type { CalendarQueryDto } from "./dto/calendar-query.dto";

const PRIVILEGED_ROLES = new Set(["ADMIN", "MANAGER", "SUPPORT_MANAGER"]);

@Injectable()
export class CalendarService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}


  async filterOptions(actor: AuthUser) {
    if (!actor.roles.some((role) => PRIVILEGED_ROLES.has(role))) {
      throw new ForbiddenException({
        code: "CALENDAR_FILTER_OPTIONS_DENIED",
        message: "Global calendar filters are available only to school staff",
      });
    }

    const [teachersResult, studentsResult, subjectsResult, managersResult] = await Promise.all([
      this.db.execute(sql`
        SELECT user_id AS id, first_name, last_name
        FROM teacher_profiles
        WHERE archived_at IS NULL AND status <> 'ARCHIVED'
        ORDER BY last_name, first_name
      `),
      this.db.execute(sql`
        SELECT id, first_name, last_name
        FROM students
        WHERE archived_at IS NULL
        ORDER BY last_name, first_name
      `),
      this.db.execute(sql`
        SELECT id, name
        FROM subjects
        WHERE status = 'ACTIVE'
        ORDER BY name
      `),
      this.db.execute(sql`
        SELECT DISTINCT sp.user_id AS id, sp.first_name, sp.last_name
        FROM staff_profiles sp
        JOIN user_roles ur ON ur.user_id = sp.user_id
        JOIN roles r ON r.id = ur.role_id
        WHERE r.code = 'MANAGER' AND sp.archived_at IS NULL
        ORDER BY sp.last_name, sp.first_name
      `),
    ]);

    const person = (row: any) => ({
      id: row.id as string,
      name: `${row.last_name} ${row.first_name}`.trim(),
    });

    return {
      teachers: teachersResult.rows.map(person),
      students: studentsResult.rows.map(person),
      subjects: subjectsResult.rows.map((row: any) => ({ id: row.id as string, name: row.name as string })),
      managers: managersResult.rows.map(person),
    };
  }

  async list(dto: CalendarQueryDto, actor: AuthUser) {
    if (dto.to < dto.from) {
      throw new BadRequestException({ code: "INVALID_CALENDAR_RANGE", message: "Calendar 'to' must be on or after 'from'" });
    }

    const rangeDays = Math.round(
      (new Date(`${dto.to}T00:00:00.000Z`).getTime() - new Date(`${dto.from}T00:00:00.000Z`).getTime()) / 86_400_000,
    );
    if (rangeDays > 93) {
      throw new BadRequestException({ code: "CALENDAR_RANGE_TOO_LARGE", message: "Calendar range cannot exceed 93 days" });
    }

    const from = schoolLocalDateTimeToUtc(dto.from, "00:00");
    const toExclusive = schoolLocalDateTimeToUtc(addDaysToDateOnly(dto.to, 1), "00:00");

    const conditions = [
      gte(liveSessions.startsAt, from),
      lt(liveSessions.startsAt, toExclusive),
      notInArray(liveSessions.status, ["CANCELLED", "EXPIRED_UNPAID"]),
    ];

    const privileged = actor.roles.some((role) => PRIVILEGED_ROLES.has(role));

    if (privileged) {
      if (dto.managerId) {
        const managed = await this.db.execute(sql`SELECT student_id FROM student_manager_assignments WHERE manager_user_id=${dto.managerId} AND ended_at IS NULL`);
        const ids = managed.rows.map((row:any) => row.student_id as string);
        if (!ids.length) return [];
        conditions.push(inArray(liveSessions.studentId, ids));
      }
      if (dto.teacherId) conditions.push(eq(liveSessions.actualTeacherId, dto.teacherId));
      if (dto.studentId) conditions.push(eq(liveSessions.studentId, dto.studentId));
      if (dto.subjectId) conditions.push(eq(liveSessions.subjectId, dto.subjectId));
      if (dto.sessionType) conditions.push(eq(liveSessions.sessionType, dto.sessionType));
      if (dto.fundingStatus) conditions.push(eq(liveSessions.fundingStatus, dto.fundingStatus));
    } else if (actor.roles.includes("TEACHER")) {
      conditions.push(eq(liveSessions.actualTeacherId, actor.id));
      if (dto.studentId) conditions.push(eq(liveSessions.studentId, dto.studentId));
      if (dto.subjectId) conditions.push(eq(liveSessions.subjectId, dto.subjectId));
    } else if (actor.roles.includes("PARENT")) {
      const [parent] = await this.db
        .select({ familyId: parentProfiles.familyId })
        .from(parentProfiles)
        .where(eq(parentProfiles.userId, actor.id))
        .limit(1);
      if (!parent) throw new NotFoundException({ code: "PARENT_PROFILE_NOT_FOUND", message: "Parent profile not found" });
      conditions.push(eq(students.familyId, parent.familyId));
      if (dto.studentId) conditions.push(eq(liveSessions.studentId, dto.studentId));
      if (dto.subjectId) conditions.push(eq(liveSessions.subjectId, dto.subjectId));
    } else if (actor.roles.includes("STUDENT")) {
      const [student] = await this.db
        .select({ id: students.id })
        .from(students)
        .where(eq(students.userId, actor.id))
        .limit(1);
      if (!student) throw new NotFoundException({ code: "STUDENT_PROFILE_NOT_FOUND", message: "Student profile not found" });
      conditions.push(eq(liveSessions.studentId, student.id));
      if (dto.subjectId) conditions.push(eq(liveSessions.subjectId, dto.subjectId));
    } else {
      throw new ForbiddenException({ code: "CALENDAR_SCOPE_DENIED", message: "Calendar access is not available for this role" });
    }

    const rows = await this.db
      .select({
        id: liveSessions.id,
        startsAt: liveSessions.startsAt,
        endsAt: liveSessions.endsAt,
        sessionType: liveSessions.sessionType,
        fundingStatus: liveSessions.fundingStatus,
        status: liveSessions.status,
        studentId: students.id,
        studentFirstName: students.firstName,
        studentLastName: students.lastName,
        subjectId: subjects.id,
        subjectName: subjects.name,
        actualTeacherId: teacherProfiles.userId,
        teacherFirstName: teacherProfiles.firstName,
        teacherLastName: teacherProfiles.lastName,
        zoomUrl: teacherProfiles.zoomUrl,
        pendingReportRequestId: progressReportRequests.id,
      })
      .from(liveSessions)
      .innerJoin(students, eq(liveSessions.studentId, students.id))
      .innerJoin(subjects, eq(liveSessions.subjectId, subjects.id))
      .innerJoin(teacherProfiles, eq(liveSessions.actualTeacherId, teacherProfiles.userId))
      .leftJoin(
        progressReportRequests,
        and(
          eq(progressReportRequests.targetSessionId, liveSessions.id),
          eq(progressReportRequests.status, "PENDING"),
        ),
      )
      .where(and(...conditions))
      .orderBy(asc(liveSessions.startsAt));

    return rows.map((row) => ({
      id: row.id,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      sessionType: row.sessionType,
      fundingStatus: row.fundingStatus,
      status: row.status,
      student: {
        id: row.studentId,
        fullName: `${row.studentFirstName} ${row.studentLastName}`,
      },
      subject: { id: row.subjectId, name: row.subjectName },
      teacher: {
        id: row.actualTeacherId,
        fullName: `${row.teacherFirstName} ${row.teacherLastName}`,
        zoomUrl: row.zoomUrl,
      },
      needsReport: Boolean(row.pendingReportRequestId),
      reportRequestId: row.pendingReportRequestId ?? null,
    }));
  }
}
