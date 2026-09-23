import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  liveSessions,
  parentProfiles,
  studentSubjectEnrollments,
  students,
  subjects,
  teacherAssignments,
  teacherProfiles,
  teacherSubjects,
} from "@school/db";
import type { Database } from "@school/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database/database.constants";
import { isPgUniqueViolation, pgConstraint } from "../../common/database/pg-errors";
import type { AuthUser } from "../auth/types";
import { AuditService } from "../audit/audit.service";
import type { AssignTeacherDto } from "./dto/assign-teacher.dto";
import type { CreateEnrollmentDto } from "./dto/create-enrollment.dto";

@Injectable()
export class EnrollmentsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async create(studentId: string, dto: CreateEnrollmentDto, actor: AuthUser, requestId?: string) {
    const [student] = await this.db
      .select({ id: students.id })
      .from(students)
      .where(and(eq(students.id, studentId), isNull(students.archivedAt)))
      .limit(1);
    if (!student) {
      throw new NotFoundException({ code: "STUDENT_NOT_FOUND", message: "Student not found" });
    }

    const [subject] = await this.db
      .select({ id: subjects.id, name: subjects.name })
      .from(subjects)
      .where(and(eq(subjects.id, dto.subjectId), eq(subjects.status, "ACTIVE")))
      .limit(1);
    if (!subject) {
      throw new NotFoundException({ code: "SUBJECT_NOT_FOUND", message: "Active subject not found" });
    }

    try {
      return await this.db.transaction(async (tx) => {
        const [enrollment] = await tx
          .insert(studentSubjectEnrollments)
          .values({
            studentId,
            subjectId: dto.subjectId,
            defaultDurationMinutes: dto.defaultDurationMinutes ?? 60,
            status: "ACTIVE",
          })
          .returning();

        await this.audit.record(
          {
            actorUserId: actor.id,
            actorRoleCode: actor.roles[0],
            action: "CREATE_STUDENT_SUBJECT_ENROLLMENT",
            entityType: "StudentSubjectEnrollment",
            entityId: enrollment.id,
            requestId,
            afterData: {
              studentId,
              subjectId: dto.subjectId,
              subjectName: subject.name,
              defaultDurationMinutes: enrollment.defaultDurationMinutes,
            },
          },
          tx,
        );

        return enrollment;
      });
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        throw new ConflictException({
          code: "ENROLLMENT_ALREADY_EXISTS",
          message: "This student already has an enrollment for the subject",
        });
      }
      throw error;
    }
  }

  async listForStudent(studentId: string, actor: AuthUser) {
    await this.assertCanViewStudent(studentId, actor);
    const [student] = await this.db.select({ id: students.id }).from(students).where(eq(students.id, studentId)).limit(1);
    if (!student) {
      throw new NotFoundException({ code: "STUDENT_NOT_FOUND", message: "Student not found" });
    }

    const rows = await this.db
      .select({
        id: studentSubjectEnrollments.id,
        subjectId: subjects.id,
        subjectName: subjects.name,
        status: studentSubjectEnrollments.status,
        defaultDurationMinutes: studentSubjectEnrollments.defaultDurationMinutes,
        startedAt: studentSubjectEnrollments.startedAt,
        teacherId: teacherAssignments.teacherId,
        teacherFirstName: teacherProfiles.firstName,
        teacherLastName: teacherProfiles.lastName,
      })
      .from(studentSubjectEnrollments)
      .innerJoin(subjects, eq(studentSubjectEnrollments.subjectId, subjects.id))
      .leftJoin(
        teacherAssignments,
        and(
          eq(studentSubjectEnrollments.id, teacherAssignments.enrollmentId),
          isNull(teacherAssignments.endedAt),
        ),
      )
      .leftJoin(teacherProfiles, eq(teacherAssignments.teacherId, teacherProfiles.userId))
      .where(
        actor.roles.includes("TEACHER") && !actor.roles.some((role) => ["ADMIN", "MANAGER", "SUPPORT_MANAGER"].includes(role))
          ? and(
              eq(studentSubjectEnrollments.studentId, studentId),
              sql`(
                ${teacherAssignments.teacherId} = ${actor.id}
                OR EXISTS (
                  SELECT 1 FROM live_sessions ls
                  WHERE ls.enrollment_id = ${studentSubjectEnrollments.id}
                    AND ls.actual_teacher_id = ${actor.id}
                )
              )`,
            )
          : eq(studentSubjectEnrollments.studentId, studentId),
      );

    return rows.map((row) => ({
      id: row.id,
      subject: { id: row.subjectId, name: row.subjectName },
      status: row.status,
      defaultDurationMinutes: row.defaultDurationMinutes,
      startedAt: row.startedAt,
      primaryTeacher: row.teacherId
        ? {
            id: row.teacherId,
            firstName: row.teacherFirstName,
            lastName: row.teacherLastName,
          }
        : null,
    }));
  }

  async getById(enrollmentId: string, actor: AuthUser) {
    await this.assertCanViewEnrollment(enrollmentId, actor);
    const [row] = await this.db
      .select({
        id: studentSubjectEnrollments.id,
        studentId: studentSubjectEnrollments.studentId,
        subjectId: studentSubjectEnrollments.subjectId,
        subjectName: subjects.name,
        status: studentSubjectEnrollments.status,
        defaultDurationMinutes: studentSubjectEnrollments.defaultDurationMinutes,
        startedAt: studentSubjectEnrollments.startedAt,
        teacherId: teacherAssignments.teacherId,
        teacherFirstName: teacherProfiles.firstName,
        teacherLastName: teacherProfiles.lastName,
      })
      .from(studentSubjectEnrollments)
      .innerJoin(subjects, eq(studentSubjectEnrollments.subjectId, subjects.id))
      .leftJoin(
        teacherAssignments,
        and(eq(studentSubjectEnrollments.id, teacherAssignments.enrollmentId), isNull(teacherAssignments.endedAt)),
      )
      .leftJoin(teacherProfiles, eq(teacherAssignments.teacherId, teacherProfiles.userId))
      .where(eq(studentSubjectEnrollments.id, enrollmentId))
      .limit(1);

    if (!row) {
      throw new NotFoundException({ code: "ENROLLMENT_NOT_FOUND", message: "Enrollment not found" });
    }

    return {
      id: row.id,
      studentId: row.studentId,
      subject: { id: row.subjectId, name: row.subjectName },
      status: row.status,
      defaultDurationMinutes: row.defaultDurationMinutes,
      startedAt: row.startedAt,
      primaryTeacher: row.teacherId
        ? { id: row.teacherId, firstName: row.teacherFirstName, lastName: row.teacherLastName }
        : null,
    };
  }

  private async assertCanViewStudent(studentId: string, actor: AuthUser) {
    if (actor.roles.some((role) => ["ADMIN", "MANAGER", "SUPPORT_MANAGER"].includes(role))) return;
    const result = await this.db.execute(sql`
      SELECT st.user_id AS student_user_id, st.family_id, pp.family_id AS parent_family_id,
             EXISTS (
               SELECT 1 FROM student_subject_enrollments e
               LEFT JOIN teacher_assignments ta ON ta.enrollment_id = e.id AND ta.ended_at IS NULL
               WHERE e.student_id = st.id AND (
                 ta.teacher_id = ${actor.id}
                 OR EXISTS (SELECT 1 FROM live_sessions ls WHERE ls.enrollment_id = e.id AND ls.actual_teacher_id = ${actor.id})
               )
             ) AS teacher_related
      FROM students st
      LEFT JOIN parent_profiles pp ON pp.user_id = ${actor.id}
      WHERE st.id = ${studentId}
      LIMIT 1
    `);
    if (!result.rowCount) throw new NotFoundException({ code: "STUDENT_NOT_FOUND", message: "Student not found" });
    const row = result.rows[0] as any;
    if (actor.roles.includes("PARENT") && row.parent_family_id === row.family_id) return;
    if (actor.roles.includes("STUDENT") && row.student_user_id === actor.id) return;
    if (actor.roles.includes("TEACHER") && row.teacher_related) return;
    throw new ForbiddenException({ code: "STUDENT_SCOPE_DENIED", message: "You cannot view this student" });
  }

  private async assertCanViewEnrollment(enrollmentId: string, actor: AuthUser) {
    const [enrollment] = await this.db.select({ studentId: studentSubjectEnrollments.studentId })
      .from(studentSubjectEnrollments).where(eq(studentSubjectEnrollments.id, enrollmentId)).limit(1);
    if (!enrollment) throw new NotFoundException({ code: "ENROLLMENT_NOT_FOUND", message: "Enrollment not found" });

    if (actor.roles.includes("TEACHER") && !actor.roles.some((role) => ["ADMIN", "MANAGER", "SUPPORT_MANAGER"].includes(role))) {
      const scope = await this.db.execute(sql`
        SELECT EXISTS (
          SELECT 1
          FROM teacher_assignments ta
          WHERE ta.enrollment_id = ${enrollmentId}
            AND ta.teacher_id = ${actor.id}
        ) OR EXISTS (
          SELECT 1
          FROM live_sessions ls
          WHERE ls.enrollment_id = ${enrollmentId}
            AND ls.actual_teacher_id = ${actor.id}
        ) AS allowed
      `);
      if (!(scope.rows[0] as { allowed: boolean } | undefined)?.allowed) {
        throw new ForbiddenException({ code: "ENROLLMENT_SCOPE_DENIED", message: "You cannot view this enrollment" });
      }
      return;
    }

    await this.assertCanViewStudent(enrollment.studentId, actor);
  }

  async assignTeacher(
    enrollmentId: string,
    dto: AssignTeacherDto,
    actor: AuthUser,
    requestId?: string,
  ) {
    return this.db.transaction(async (tx) => {
      const locked = await tx.execute(sql`
        SELECT id, subject_id, status
        FROM student_subject_enrollments
        WHERE id = ${enrollmentId}
        FOR UPDATE
      `);

      if (!locked.rowCount) {
        throw new NotFoundException({ code: "ENROLLMENT_NOT_FOUND", message: "Enrollment not found" });
      }

      const enrollment = locked.rows[0] as { id: string; subject_id: string; status: string };
      if (enrollment.status === "INACTIVE") {
        throw new ConflictException({
          code: "ENROLLMENT_INACTIVE",
          message: "Cannot assign a teacher to an inactive enrollment",
        });
      }

      const [teacherSubject] = await tx
        .select({
          teacherId: teacherProfiles.userId,
          teacherStatus: teacherProfiles.status,
          isActive: teacherSubjects.isActive,
        })
        .from(teacherSubjects)
        .innerJoin(teacherProfiles, eq(teacherSubjects.teacherId, teacherProfiles.userId))
        .where(
          and(
            eq(teacherSubjects.teacherId, dto.teacherId),
            eq(teacherSubjects.subjectId, enrollment.subject_id),
            eq(teacherSubjects.isActive, true),
          ),
        )
        .limit(1);

      if (!teacherSubject || teacherSubject.teacherStatus === "ARCHIVED") {
        throw new ConflictException({
          code: "TEACHER_DOES_NOT_TEACH_SUBJECT",
          message: "Teacher is not active for this subject",
        });
      }

      const [current] = await tx
        .select({ id: teacherAssignments.id, teacherId: teacherAssignments.teacherId })
        .from(teacherAssignments)
        .where(and(eq(teacherAssignments.enrollmentId, enrollmentId), isNull(teacherAssignments.endedAt)))
        .limit(1);

      if (current?.teacherId === dto.teacherId) {
        return current;
      }

      if (current) {
        await tx.update(teacherAssignments).set({ endedAt: new Date() }).where(eq(teacherAssignments.id, current.id));
      }

      try {
        const [assignment] = await tx
          .insert(teacherAssignments)
          .values({
            enrollmentId,
            teacherId: dto.teacherId,
            assignedBy: actor.id,
          })
          .returning();

        await this.audit.record(
          {
            actorUserId: actor.id,
            actorRoleCode: actor.roles[0],
            action: current ? "CHANGE_PRIMARY_TEACHER" : "ASSIGN_PRIMARY_TEACHER",
            entityType: "StudentSubjectEnrollment",
            entityId: enrollmentId,
            requestId,
            beforeData: current ? { teacherId: current.teacherId } : undefined,
            afterData: { teacherId: dto.teacherId },
          },
          tx,
        );

        return assignment;
      } catch (error) {
        if (isPgUniqueViolation(error) && pgConstraint(error) === "one_active_teacher_per_enrollment") {
          throw new ConflictException({
            code: "ACTIVE_TEACHER_ALREADY_ASSIGNED",
            message: "Enrollment already has an active primary teacher",
          });
        }
        throw error;
      }
    });
  }
}
