import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  families,
  parentProfiles,
  roles,
  staffProfiles,
  studentManagerAssignments,
  students,
  userRoles,
  users,
} from "@school/db";
import type { Database } from "@school/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database/database.constants";
import { isPgUniqueViolation } from "../../common/database/pg-errors";
import type { AuthUser } from "../auth/types";
import { AuditService } from "../audit/audit.service";
import type { ArchiveStudentDto } from "./dto/archive-student.dto";
import type { AssignPrimaryManagerDto } from "./dto/assign-primary-manager.dto";
import type { CreateStudentDto } from "./dto/create-student.dto";
import type { UpdateStudentDto } from "./dto/update-student.dto";

@Injectable()
export class StudentsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async create(familyId: string, dto: CreateStudentDto, actor: AuthUser, requestId?: string) {
    const [family] = await this.db.select({ id: families.id, archivedAt: families.archivedAt }).from(families).where(eq(families.id, familyId)).limit(1);
    if (!family) throw new NotFoundException({ code: "FAMILY_NOT_FOUND", message: "Family not found" });
    if (family.archivedAt) throw new ConflictException({ code: "FAMILY_ARCHIVED", message: "Reactivate the family before adding a child" });

    const accountEmail = dto.studentAccountEmail?.trim().toLowerCase();
    if (accountEmail) {
      const existing = await this.db.query.users.findFirst({ where: eq(users.email, accountEmail), columns: { id: true } });
      if (existing) throw new ConflictException({ code: "EMAIL_ALREADY_IN_USE", message: "This email is already used by another account" });
    }

    try {
      return await this.db.transaction(async (tx) => {
        let studentUserId: string | null = null;
        if (accountEmail) {
          const [studentRole] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.code, "STUDENT")).limit(1);
          if (!studentRole) throw new Error("STUDENT role is not seeded");
          const [studentUser] = await tx.insert(users).values({ email: accountEmail, status: "PENDING" }).returning({ id: users.id });
          studentUserId = studentUser.id;
          await tx.insert(userRoles).values({ userId: studentUser.id, roleId: studentRole.id, assignedBy: actor.id });
        }

        const [student] = await tx.insert(students).values({
          familyId,
          userId: studentUserId,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          birthDate: dto.birthDate,
          gradeLevel: dto.gradeLevel,
        }).returning();

        await this.audit.record({
          actorUserId: actor.id,
          actorRoleCode: actor.roles[0],
          action: "CREATE_STUDENT",
          entityType: "Student",
          entityId: student.id,
          requestId,
          afterData: { familyId, firstName: student.firstName, lastName: student.lastName, gradeLevel: student.gradeLevel, hasUserAccount: Boolean(student.userId) },
        }, tx);
        return student;
      });
    } catch (error) {
      if (isPgUniqueViolation(error)) throw new ConflictException({ code: "STUDENT_CREATE_CONFLICT", message: "The student could not be created because one of its unique values already exists" });
      throw error;
    }
  }

  async getById(studentId: string, actor: AuthUser) {
    await this.assertCanViewStudent(studentId, actor);
    const result = await this.db.execute(sql`
      SELECT st.id,st.family_id AS "familyId",st.user_id AS "userId",st.first_name AS "firstName",st.last_name AS "lastName",
             st.birth_date AS "birthDate",st.grade_level AS "gradeLevel",st.created_at AS "createdAt",st.archived_at AS "archivedAt",
             st.archived_by AS "archivedBy",st.archive_reason AS "archiveReason",
             su.email AS "accountEmail",su.status AS "accountStatus",su.email_verified_at AS "accountEmailVerifiedAt",
             (su.password_hash IS NOT NULL) AS "passwordConfigured",
             inv.created_at AS "lastInvitationAt",inv.expires_at AS "lastInvitationExpiresAt",inv.accepted_at AS "lastInvitationAcceptedAt"
      FROM students st
      LEFT JOIN users su ON su.id=st.user_id
      LEFT JOIN LATERAL (
        SELECT created_at,expires_at,accepted_at FROM user_invitations i WHERE i.user_id=su.id ORDER BY i.created_at DESC LIMIT 1
      ) inv ON true
      WHERE st.id=${studentId} LIMIT 1
    `);
    if (!result.rowCount) throw new NotFoundException({ code: "STUDENT_NOT_FOUND", message: "Student not found" });
    const student = result.rows[0] as any;

    const [parent] = await this.db.select({
      userId: parentProfiles.userId,
      email: users.email,
      firstName: parentProfiles.firstName,
      lastName: parentProfiles.lastName,
      phone: parentProfiles.phone,
    }).from(parentProfiles).innerJoin(users, eq(parentProfiles.userId, users.id)).where(eq(parentProfiles.familyId, student.familyId)).limit(1);

    const [manager] = await this.db.select({
      userId: staffProfiles.userId,
      firstName: staffProfiles.firstName,
      lastName: staffProfiles.lastName,
      phone: staffProfiles.phone,
    }).from(studentManagerAssignments).innerJoin(staffProfiles, eq(studentManagerAssignments.managerUserId, staffProfiles.userId)).where(and(eq(studentManagerAssignments.studentId, studentId), isNull(studentManagerAssignments.endedAt))).limit(1);

    return { ...student, parent: parent ?? null, primaryManager: manager ?? null };
  }

  async update(studentId: string, dto: UpdateStudentDto, actor: AuthUser, requestId?: string) {
    if (dto.firstName === undefined && dto.lastName === undefined && dto.birthDate === undefined && dto.gradeLevel === undefined) {
      throw new BadRequestException({ code: "NO_PROFILE_CHANGES", message: "No student profile changes supplied" });
    }
    return this.db.transaction(async (tx) => {
      const locked = await tx.execute(sql`SELECT * FROM students WHERE id=${studentId} FOR UPDATE`);
      if (!locked.rowCount) throw new NotFoundException({ code: "STUDENT_NOT_FOUND", message: "Student not found" });
      const before = locked.rows[0] as any;
      const updated = await tx.execute(sql`
        UPDATE students SET
          first_name=COALESCE(${dto.firstName?.trim() ?? null},first_name),
          last_name=COALESCE(${dto.lastName?.trim() ?? null},last_name),
          birth_date=CASE WHEN ${dto.birthDate === undefined} THEN birth_date ELSE ${dto.birthDate ?? null}::date END,
          grade_level=CASE WHEN ${dto.gradeLevel === undefined} THEN grade_level ELSE ${dto.gradeLevel ?? null}::smallint END,
          updated_at=now()
        WHERE id=${studentId}
        RETURNING id,family_id AS "familyId",user_id AS "userId",first_name AS "firstName",last_name AS "lastName",birth_date AS "birthDate",grade_level AS "gradeLevel",archived_at AS "archivedAt"
      `);
      await this.audit.record({
        actorUserId: actor.id,
        actorRoleCode: actor.roles[0],
        action: "UPDATE_STUDENT_PROFILE",
        entityType: "Student",
        entityId: studentId,
        requestId,
        beforeData: { firstName: before.first_name, lastName: before.last_name, birthDate: before.birth_date, gradeLevel: before.grade_level },
        afterData: updated.rows[0],
      }, tx as any);
      return updated.rows[0];
    });
  }

  async archive(studentId: string, dto: ArchiveStudentDto, actor: AuthUser, requestId?: string) {
    return this.db.transaction(async (tx) => {
      const locked = await tx.execute(sql`SELECT id,user_id,archived_at FROM students WHERE id=${studentId} FOR UPDATE`);
      if (!locked.rowCount) throw new NotFoundException({ code: "STUDENT_NOT_FOUND", message: "Student not found" });
      const student = locked.rows[0] as any;
      if (student.archived_at) return { id: studentId, archived: true, changed: false };

      const blockers = await tx.execute(sql`
        SELECT
          (SELECT COUNT(*)::int FROM student_subject_enrollments WHERE student_id=${studentId} AND status='ACTIVE') AS active_enrollments,
          (SELECT COUNT(*)::int FROM live_sessions WHERE student_id=${studentId} AND status='SCHEDULED' AND starts_at>now()) AS future_sessions
      `);
      const b = blockers.rows[0] as any;
      if (Number(b.active_enrollments) > 0 || Number(b.future_sessions) > 0) {
        throw new ConflictException({
          code: "STUDENT_ARCHIVE_BLOCKED",
          message: "Finish or pause active learning and resolve future lessons before archiving the student",
          details: { activeEnrollments: Number(b.active_enrollments), futureSessions: Number(b.future_sessions) },
        });
      }

      const reason = dto.reason?.trim() || null;
      await tx.execute(sql`UPDATE students SET archived_at=now(),archived_by=${actor.id},archive_reason=${reason},updated_at=now() WHERE id=${studentId}`);
      if (student.user_id) {
        await tx.execute(sql`
          UPDATE users SET status=CASE WHEN status='SUSPENDED' THEN status ELSE 'ARCHIVED'::user_status END,archived_at=now(),updated_at=now()
          WHERE id=${student.user_id}
        `);
        await tx.execute(sql`UPDATE user_sessions SET revoked_at=now() WHERE user_id=${student.user_id} AND revoked_at IS NULL`);
      }
      await this.audit.record({ actorUserId: actor.id, actorRoleCode: actor.roles[0], action: "ARCHIVE_STUDENT", entityType: "Student", entityId: studentId, requestId, afterData: { reason } }, tx as any);
      return { id: studentId, archived: true, changed: true };
    });
  }

  async reactivate(studentId: string, actor: AuthUser, requestId?: string) {
    return this.db.transaction(async (tx) => {
      const locked = await tx.execute(sql`SELECT id,family_id,user_id,archived_at FROM students WHERE id=${studentId} FOR UPDATE`);
      if (!locked.rowCount) throw new NotFoundException({ code: "STUDENT_NOT_FOUND", message: "Student not found" });
      const student = locked.rows[0] as any;
      if (!student.archived_at) return { id: studentId, archived: false, changed: false };
      const family = await tx.execute(sql`SELECT archived_at FROM families WHERE id=${student.family_id}`);
      if ((family.rows[0] as any)?.archived_at) throw new ConflictException({ code: "FAMILY_ARCHIVED", message: "Reactivate the family before reactivating the student" });

      await tx.execute(sql`UPDATE students SET archived_at=NULL,archived_by=NULL,archive_reason=NULL,updated_at=now() WHERE id=${studentId}`);
      if (student.user_id) {
        await tx.execute(sql`
          UPDATE users SET status=CASE WHEN status='ARCHIVED' THEN CASE WHEN password_hash IS NULL THEN 'PENDING'::user_status ELSE 'ACTIVE'::user_status END ELSE status END,
            archived_at=NULL,updated_at=now() WHERE id=${student.user_id}
        `);
      }
      await this.audit.record({ actorUserId: actor.id, actorRoleCode: actor.roles[0], action: "REACTIVATE_STUDENT", entityType: "Student", entityId: studentId, requestId }, tx as any);
      return { id: studentId, archived: false, changed: true };
    });
  }

  private async assertCanViewStudent(studentId: string, actor: AuthUser) {
    if (actor.roles.some((role) => ["ADMIN", "MANAGER", "SUPPORT_MANAGER"].includes(role))) return;
    const result = await this.db.execute(sql`
      SELECT st.user_id AS student_user_id,st.family_id,pp.family_id AS parent_family_id,
        EXISTS (
          SELECT 1 FROM student_subject_enrollments e
          LEFT JOIN teacher_assignments ta ON ta.enrollment_id=e.id AND ta.ended_at IS NULL
          WHERE e.student_id=st.id AND (ta.teacher_id=${actor.id} OR EXISTS (SELECT 1 FROM live_sessions ls WHERE ls.enrollment_id=e.id AND ls.actual_teacher_id=${actor.id}))
        ) AS teacher_related
      FROM students st LEFT JOIN parent_profiles pp ON pp.user_id=${actor.id}
      WHERE st.id=${studentId} LIMIT 1
    `);
    if (!result.rowCount) throw new NotFoundException({ code: "STUDENT_NOT_FOUND", message: "Student not found" });
    const row = result.rows[0] as any;
    if (actor.roles.includes("PARENT") && row.parent_family_id === row.family_id) return;
    if (actor.roles.includes("STUDENT") && row.student_user_id === actor.id) return;
    if (actor.roles.includes("TEACHER") && row.teacher_related) return;
    throw new ForbiddenException({ code: "STUDENT_SCOPE_DENIED", message: "You cannot view this student" });
  }

  async assignPrimaryManager(studentId: string, dto: AssignPrimaryManagerDto, actor: AuthUser, requestId?: string) {
    const [manager] = await this.db.select({ userId: staffProfiles.userId, firstName: staffProfiles.firstName, lastName: staffProfiles.lastName })
      .from(staffProfiles).innerJoin(users, eq(staffProfiles.userId, users.id)).innerJoin(userRoles, eq(staffProfiles.userId, userRoles.userId)).innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(and(eq(staffProfiles.userId, dto.managerUserId), eq(roles.code, "MANAGER"), eq(users.status, "ACTIVE"), isNull(staffProfiles.archivedAt))).limit(1);
    if (!manager) throw new NotFoundException({ code: "ACTIVE_MANAGER_NOT_FOUND", message: "Active manager not found" });

    return this.db.transaction(async (tx) => {
      const locked = await tx.execute(sql`SELECT id,archived_at FROM students WHERE id=${studentId} FOR UPDATE`);
      if (!locked.rowCount) throw new NotFoundException({ code: "STUDENT_NOT_FOUND", message: "Student not found" });
      if ((locked.rows[0] as any).archived_at) throw new ConflictException({ code: "STUDENT_ARCHIVED", message: "Reactivate the student before changing the primary manager" });

      const [current] = await tx.select({ id: studentManagerAssignments.id, managerUserId: studentManagerAssignments.managerUserId }).from(studentManagerAssignments)
        .where(and(eq(studentManagerAssignments.studentId, studentId), isNull(studentManagerAssignments.endedAt))).limit(1);
      if (current?.managerUserId === dto.managerUserId) return { studentId, primaryManager: manager, changed: false };

      const changedAt = new Date();
      if (current) await tx.update(studentManagerAssignments).set({ endedAt: changedAt }).where(eq(studentManagerAssignments.id, current.id));
      const [assignment] = await tx.insert(studentManagerAssignments).values({ studentId, managerUserId: dto.managerUserId, startedAt: changedAt, assignedBy: actor.id }).returning({ id: studentManagerAssignments.id, startedAt: studentManagerAssignments.startedAt });
      await this.audit.record({
        actorUserId: actor.id, actorRoleCode: actor.roles[0], action: "ASSIGN_PRIMARY_MANAGER", entityType: "Student", entityId: studentId, requestId,
        beforeData: { managerUserId: current?.managerUserId ?? null }, afterData: { managerUserId: dto.managerUserId },
      }, tx);
      return { id: assignment.id, studentId, startedAt: assignment.startedAt, primaryManager: manager, changed: true };
    });
  }
}
