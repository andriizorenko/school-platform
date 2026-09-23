import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
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
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database/database.constants";
import { isPgUniqueViolation } from "../../common/database/pg-errors";
import type { AuthUser } from "../auth/types";
import { AuditService } from "../audit/audit.service";
import type { ArchiveFamilyDto } from "./dto/archive-family.dto";
import type { CreateFamilyDto } from "./dto/create-family.dto";
import type { UpdateParentProfileDto } from "./dto/update-parent-profile.dto";

@Injectable()
export class FamiliesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateFamilyDto, actor: AuthUser, requestId?: string) {
    const email = dto.parent.email.trim().toLowerCase();
    const existingUser = await this.db.query.users.findFirst({
      where: eq(users.email, email),
      columns: { id: true },
    });

    if (existingUser) {
      throw new ConflictException({ code: "EMAIL_ALREADY_IN_USE", message: "This email is already used by another account" });
    }

    try {
      return await this.db.transaction(async (tx) => {
        const [parentRole] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.code, "PARENT")).limit(1);
        if (!parentRole) throw new Error("PARENT role is not seeded");

        const [user] = await tx.insert(users).values({ email, status: "PENDING" }).returning({ id: users.id, email: users.email, status: users.status });
        const [family] = await tx.insert(families).values({}).returning({ id: families.id, createdAt: families.createdAt });

        await tx.insert(parentProfiles).values({
          userId: user.id,
          familyId: family.id,
          firstName: dto.parent.firstName.trim(),
          lastName: dto.parent.lastName.trim(),
          phone: dto.parent.phone.trim(),
        });
        await tx.insert(userRoles).values({ userId: user.id, roleId: parentRole.id, assignedBy: actor.id });

        await this.audit.record({
          actorUserId: actor.id,
          actorRoleCode: actor.roles[0],
          action: "CREATE_FAMILY",
          entityType: "Family",
          entityId: family.id,
          requestId,
          afterData: {
            parentUserId: user.id,
            parentEmail: email,
            parentFirstName: dto.parent.firstName.trim(),
            parentLastName: dto.parent.lastName.trim(),
          },
        }, tx);

        return {
          id: family.id,
          createdAt: family.createdAt,
          parent: {
            userId: user.id,
            email: user.email,
            status: user.status,
            firstName: dto.parent.firstName.trim(),
            lastName: dto.parent.lastName.trim(),
            phone: dto.parent.phone.trim(),
          },
        };
      });
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        throw new ConflictException({ code: "FAMILY_CREATE_CONFLICT", message: "The family could not be created because one of its unique values already exists" });
      }
      throw error;
    }
  }

  async getById(familyId: string) {
    const [family] = await this.db.select().from(families).where(eq(families.id, familyId)).limit(1);
    if (!family) throw new NotFoundException({ code: "FAMILY_NOT_FOUND", message: "Family not found" });

    const parentResult = await this.db.execute(sql`
      SELECT pp.user_id AS "userId", u.email, u.status AS "userStatus",
             pp.first_name AS "firstName", pp.last_name AS "lastName", pp.phone,
             u.email_verified_at AS "emailVerifiedAt",
             (u.password_hash IS NOT NULL) AS "passwordConfigured",
             inv.created_at AS "lastInvitationAt", inv.expires_at AS "lastInvitationExpiresAt", inv.accepted_at AS "lastInvitationAcceptedAt"
      FROM parent_profiles pp
      JOIN users u ON u.id=pp.user_id
      LEFT JOIN LATERAL (
        SELECT created_at,expires_at,accepted_at
        FROM user_invitations i WHERE i.user_id=u.id ORDER BY i.created_at DESC LIMIT 1
      ) inv ON true
      WHERE pp.family_id=${familyId}
      LIMIT 1
    `);

    const childrenResult = await this.db.execute(sql`
      SELECT st.id, st.user_id AS "userId", st.first_name AS "firstName", st.last_name AS "lastName",
             st.birth_date AS "birthDate", st.grade_level AS "gradeLevel", st.archived_at AS "archivedAt",
             st.archived_by AS "archivedBy", st.archive_reason AS "archiveReason",
             su.email AS "accountEmail", su.status AS "accountStatus",
             (su.password_hash IS NOT NULL) AS "passwordConfigured",
             inv.created_at AS "lastInvitationAt", inv.expires_at AS "lastInvitationExpiresAt", inv.accepted_at AS "lastInvitationAcceptedAt"
      FROM students st
      LEFT JOIN users su ON su.id=st.user_id
      LEFT JOIN LATERAL (
        SELECT created_at,expires_at,accepted_at
        FROM user_invitations i WHERE i.user_id=su.id ORDER BY i.created_at DESC LIMIT 1
      ) inv ON true
      WHERE st.family_id=${familyId}
      ORDER BY st.archived_at NULLS FIRST, st.last_name,st.first_name
    `);
    const children = childrenResult.rows as any[];

    const managerMap = new Map<string, { userId: string; firstName: string; lastName: string }>();
    if (children.length) {
      const assignments = await this.db
        .select({
          studentId: studentManagerAssignments.studentId,
          managerUserId: staffProfiles.userId,
          firstName: staffProfiles.firstName,
          lastName: staffProfiles.lastName,
        })
        .from(studentManagerAssignments)
        .innerJoin(staffProfiles, eq(studentManagerAssignments.managerUserId, staffProfiles.userId))
        .where(and(inArray(studentManagerAssignments.studentId, children.map((child) => child.id)), isNull(studentManagerAssignments.endedAt)));
      for (const assignment of assignments) managerMap.set(assignment.studentId, { userId: assignment.managerUserId, firstName: assignment.firstName, lastName: assignment.lastName });
    }

    return {
      id: family.id,
      createdAt: family.createdAt,
      archivedAt: family.archivedAt,
      archivedBy: family.archivedBy,
      archiveReason: family.archiveReason,
      parent: (parentResult.rows[0] as any) ?? null,
      students: children.map((child) => ({ ...child, primaryManager: managerMap.get(child.id) ?? null })),
    };
  }

  async updateParent(familyId: string, dto: UpdateParentProfileDto, actor: AuthUser, requestId?: string) {
    if (!dto.firstName && !dto.lastName && !dto.phone && !dto.email) {
      throw new BadRequestException({ code: "NO_PROFILE_CHANGES", message: "No parent profile changes supplied" });
    }
    try {
      return await this.db.transaction(async (tx) => {
        const locked = await tx.execute(sql`
          SELECT f.id,pp.user_id,pp.first_name,pp.last_name,pp.phone,u.email
          FROM families f JOIN parent_profiles pp ON pp.family_id=f.id JOIN users u ON u.id=pp.user_id
          WHERE f.id=${familyId} FOR UPDATE OF f,pp,u
        `);
        if (!locked.rowCount) throw new NotFoundException({ code: "FAMILY_NOT_FOUND", message: "Family not found" });
        const before = locked.rows[0] as any;
        const email = dto.email?.trim().toLowerCase();
        await tx.execute(sql`
          UPDATE parent_profiles
          SET first_name=COALESCE(${dto.firstName?.trim() ?? null},first_name),
              last_name=COALESCE(${dto.lastName?.trim() ?? null},last_name),
              phone=COALESCE(${dto.phone?.trim() ?? null},phone),updated_at=now()
          WHERE family_id=${familyId}
        `);
        if (email && email !== String(before.email).toLowerCase()) {
          await tx.execute(sql`UPDATE users SET email=${email},updated_at=now() WHERE id=${before.user_id}`);
        }
        const updated = await tx.execute(sql`
          SELECT pp.user_id AS "userId",pp.first_name AS "firstName",pp.last_name AS "lastName",pp.phone,u.email,u.status AS "userStatus"
          FROM parent_profiles pp JOIN users u ON u.id=pp.user_id WHERE pp.family_id=${familyId}
        `);
        await this.audit.record({
          actorUserId: actor.id,
          actorRoleCode: actor.roles[0],
          action: "UPDATE_PARENT_PROFILE",
          entityType: "Family",
          entityId: familyId,
          requestId,
          beforeData: { firstName: before.first_name, lastName: before.last_name, phone: before.phone, email: before.email },
          afterData: updated.rows[0],
        }, tx as any);
        return updated.rows[0];
      });
    } catch (error) {
      if (isPgUniqueViolation(error)) throw new ConflictException({ code: "EMAIL_ALREADY_IN_USE", message: "This email is already used by another account" });
      throw error;
    }
  }

  async archive(familyId: string, dto: ArchiveFamilyDto, actor: AuthUser, requestId?: string) {
    return this.db.transaction(async (tx) => {
      const locked = await tx.execute(sql`
        SELECT f.id,f.archived_at,pp.user_id,u.status
        FROM families f LEFT JOIN parent_profiles pp ON pp.family_id=f.id LEFT JOIN users u ON u.id=pp.user_id
        WHERE f.id=${familyId} FOR UPDATE OF f
      `);
      if (!locked.rowCount) throw new NotFoundException({ code: "FAMILY_NOT_FOUND", message: "Family not found" });
      const family = locked.rows[0] as any;
      if (family.archived_at) return { id: familyId, archived: true, changed: false };

      const blockers = await tx.execute(sql`
        SELECT
          (SELECT COUNT(*)::int FROM students WHERE family_id=${familyId} AND archived_at IS NULL) AS active_children,
          (SELECT COUNT(*)::int FROM course_licenses WHERE family_id=${familyId} AND status='ACTIVE' AND ends_at>now()) AS active_courses
      `);
      const b = blockers.rows[0] as any;
      if (Number(b.active_children) > 0 || Number(b.active_courses) > 0) {
        throw new ConflictException({
          code: "FAMILY_ARCHIVE_BLOCKED",
          message: "Archive every child and finish active course access before archiving the family",
          details: { activeChildren: Number(b.active_children), activeCourses: Number(b.active_courses) },
        });
      }

      const reason = dto.reason?.trim() || null;
      await tx.execute(sql`UPDATE families SET archived_at=now(),archived_by=${actor.id},archive_reason=${reason} WHERE id=${familyId}`);
      if (family.user_id) {
        await tx.execute(sql`
          UPDATE users SET status=CASE WHEN status='SUSPENDED' THEN status ELSE 'ARCHIVED'::user_status END,
            archived_at=now(),updated_at=now() WHERE id=${family.user_id}
        `);
        await tx.execute(sql`UPDATE user_sessions SET revoked_at=now() WHERE user_id=${family.user_id} AND revoked_at IS NULL`);
      }
      await this.audit.record({ actorUserId: actor.id, actorRoleCode: actor.roles[0], action: "ARCHIVE_FAMILY", entityType: "Family", entityId: familyId, requestId, afterData: { reason } }, tx as any);
      return { id: familyId, archived: true, changed: true };
    });
  }

  async reactivate(familyId: string, actor: AuthUser, requestId?: string) {
    return this.db.transaction(async (tx) => {
      const locked = await tx.execute(sql`
        SELECT f.id,f.archived_at,pp.user_id FROM families f LEFT JOIN parent_profiles pp ON pp.family_id=f.id
        WHERE f.id=${familyId} FOR UPDATE OF f
      `);
      if (!locked.rowCount) throw new NotFoundException({ code: "FAMILY_NOT_FOUND", message: "Family not found" });
      const family = locked.rows[0] as any;
      if (!family.archived_at) return { id: familyId, archived: false, changed: false };
      await tx.execute(sql`UPDATE families SET archived_at=NULL,archived_by=NULL,archive_reason=NULL WHERE id=${familyId}`);
      if (family.user_id) {
        await tx.execute(sql`
          UPDATE users SET status=CASE WHEN status='ARCHIVED' THEN CASE WHEN password_hash IS NULL THEN 'PENDING'::user_status ELSE 'ACTIVE'::user_status END ELSE status END,
            archived_at=NULL,updated_at=now() WHERE id=${family.user_id}
        `);
      }
      await this.audit.record({ actorUserId: actor.id, actorRoleCode: actor.roles[0], action: "REACTIVATE_FAMILY", entityType: "Family", entityId: familyId, requestId }, tx as any);
      return { id: familyId, archived: false, changed: true };
    });
  }
}
