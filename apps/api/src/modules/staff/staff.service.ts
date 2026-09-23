import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { roles, staffProfiles, userRoles, users } from "@school/db";
import type { Database } from "@school/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database/database.constants";
import { isPgUniqueViolation } from "../../common/database/pg-errors";
import type { AuthUser } from "../auth/types";
import { AuditService } from "../audit/audit.service";
import type { ChangeStaffRoleDto } from "./dto/change-staff-role.dto";
import type { CreateStaffDto } from "./dto/create-staff.dto";
import type { UpdateStaffDto } from "./dto/update-staff.dto";

const operationalStaffRoles = ["MANAGER", "FINANCIER", "SUPPORT_MANAGER"] as const;

@Injectable()
export class StaffService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateStaffDto, actor: AuthUser, requestId?: string) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.db.query.users.findFirst({
      where: eq(users.email, email),
      columns: { id: true },
    });

    if (existing) {
      throw new ConflictException({
        code: "EMAIL_ALREADY_IN_USE",
        message: "This email is already used by another account",
      });
    }

    try {
      return await this.db.transaction(async (tx) => {
        const [role] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.code, dto.roleCode)).limit(1);
        if (!role) throw new Error(`${dto.roleCode} role is not seeded`);

        const [user] = await tx
          .insert(users)
          .values({ email, status: "PENDING" })
          .returning({ id: users.id, email: users.email, status: users.status });

        const [profile] = await tx
          .insert(staffProfiles)
          .values({
            userId: user.id,
            firstName: dto.firstName.trim(),
            lastName: dto.lastName.trim(),
            phone: dto.phone?.trim(),
          })
          .returning();

        await tx.insert(userRoles).values({
          userId: user.id,
          roleId: role.id,
          assignedBy: actor.id,
        });

        await this.audit.record(
          {
            actorUserId: actor.id,
            actorRoleCode: actor.roles[0],
            action: "CREATE_STAFF_ACCOUNT",
            entityType: "User",
            entityId: user.id,
            requestId,
            afterData: {
              roleCode: dto.roleCode,
              email,
              firstName: profile.firstName,
              lastName: profile.lastName,
            },
          },
          tx,
        );

        return { ...profile, email: user.email, userStatus: user.status, roleCode: dto.roleCode };
      });
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        throw new ConflictException({
          code: "STAFF_CREATE_CONFLICT",
          message: "The staff account could not be created because one of its unique values already exists",
        });
      }
      throw error;
    }
  }

  async list(input: { search?: string; role?: string; status?: string } = {}) {
    const search = input.search?.trim() ? `%${input.search.trim()}%` : null;
    const role = input.role?.trim() || null;
    const status = input.status?.trim() || null;
    const result = await this.db.execute(sql`
      SELECT
        sp.user_id,
        sp.first_name,
        sp.last_name,
        sp.phone,
        sp.started_at,
        sp.archived_at,
        u.email,
        u.status AS user_status,
        u.last_login_at,
        COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), ARRAY[]::text[]) AS roles,
        (SELECT COUNT(*)::int FROM student_manager_assignments sma WHERE sma.manager_user_id=sp.user_id AND sma.ended_at IS NULL) AS active_students,
        (SELECT ui.created_at FROM user_invitations ui WHERE ui.user_id=sp.user_id ORDER BY ui.created_at DESC LIMIT 1) AS last_invited_at,
        (SELECT ui.accepted_at FROM user_invitations ui WHERE ui.user_id=sp.user_id ORDER BY ui.created_at DESC LIMIT 1) AS last_invite_accepted_at
      FROM staff_profiles sp
      JOIN users u ON u.id=sp.user_id
      LEFT JOIN user_roles ur ON ur.user_id=sp.user_id
      LEFT JOIN roles r ON r.id=ur.role_id
      WHERE (${search}::text IS NULL OR concat_ws(' ',sp.first_name,sp.last_name,sp.last_name,sp.first_name,u.email,sp.phone) ILIKE ${search})
        AND (${status}::text IS NULL OR ${status}::text='ALL' OR u.status::text=${status})
        AND (${role}::text IS NULL OR EXISTS(
          SELECT 1 FROM user_roles ur2 JOIN roles r2 ON r2.id=ur2.role_id
          WHERE ur2.user_id=sp.user_id AND r2.code=${role}
        ))
      GROUP BY sp.user_id,u.id
      ORDER BY sp.archived_at NULLS FIRST,sp.last_name,sp.first_name
    `);
    return result.rows.map((row: any) => ({
      userId: row.user_id,
      firstName: row.first_name,
      lastName: row.last_name,
      phone: row.phone,
      startedAt: row.started_at,
      archivedAt: row.archived_at,
      email: row.email,
      userStatus: row.user_status,
      lastLoginAt: row.last_login_at,
      roles: row.roles ?? [],
      activeManagedStudents: Number(row.active_students ?? 0),
      lastInvitedAt: row.last_invited_at,
      lastInviteAcceptedAt: row.last_invite_accepted_at,
    }));
  }

  async listManagers() {
    return this.db
      .select({
        userId: staffProfiles.userId,
        email: users.email,
        firstName: staffProfiles.firstName,
        lastName: staffProfiles.lastName,
        phone: staffProfiles.phone,
        startedAt: staffProfiles.startedAt,
      })
      .from(staffProfiles)
      .innerJoin(users, eq(staffProfiles.userId, users.id))
      .innerJoin(userRoles, eq(staffProfiles.userId, userRoles.userId))
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(
        and(
          eq(roles.code, "MANAGER"),
          eq(users.status, "ACTIVE"),
          isNull(staffProfiles.archivedAt),
        ),
      );
  }

  async getById(userId: string) {
    const rows = await this.db
      .select({
        userId: staffProfiles.userId,
        email: users.email,
        userStatus: users.status,
        firstName: staffProfiles.firstName,
        lastName: staffProfiles.lastName,
        phone: staffProfiles.phone,
        startedAt: staffProfiles.startedAt,
        archivedAt: staffProfiles.archivedAt,
        lastLoginAt: users.lastLoginAt,
        roleCode: roles.code,
      })
      .from(staffProfiles)
      .innerJoin(users, eq(staffProfiles.userId, users.id))
      .leftJoin(userRoles, eq(staffProfiles.userId, userRoles.userId))
      .leftJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(staffProfiles.userId, userId));

    if (!rows.length) {
      throw new NotFoundException({ code: "STAFF_NOT_FOUND", message: "Staff member not found" });
    }

    const [invite, managedStudents] = await Promise.all([
      this.db.execute(sql`SELECT created_at,expires_at,accepted_at FROM user_invitations WHERE user_id=${userId} ORDER BY created_at DESC LIMIT 1`),
      this.db.execute(sql`SELECT COUNT(*)::int count FROM student_manager_assignments WHERE manager_user_id=${userId} AND ended_at IS NULL`),
    ]);

    const first = rows[0];
    return {
      userId: first.userId,
      email: first.email,
      userStatus: first.userStatus,
      firstName: first.firstName,
      lastName: first.lastName,
      phone: first.phone,
      startedAt: first.startedAt,
      archivedAt: first.archivedAt,
      lastLoginAt: first.lastLoginAt,
      roles: rows.map((row) => row.roleCode).filter((role): role is string => Boolean(role)),
      activeManagedStudents: Number((managedStudents.rows[0] as any)?.count ?? 0),
      latestInvitation: invite.rows[0] ?? null,
    };
  }

  async update(userId: string, dto: UpdateStaffDto, actor: AuthUser, requestId?: string) {
    await this.db.transaction(async (tx) => {
      const beforeResult = await tx.execute(sql`SELECT * FROM staff_profiles WHERE user_id=${userId} FOR UPDATE`);
      if (!beforeResult.rowCount) throw new NotFoundException({ code: "STAFF_NOT_FOUND", message: "Staff member not found" });
      const before = beforeResult.rows[0] as any;
      if (before.archived_at) throw new ConflictException({ code: "STAFF_ARCHIVED", message: "Reactivate the staff member before editing" });
      const result = await tx.execute(sql`
        UPDATE staff_profiles SET
          first_name=COALESCE(${dto.firstName?.trim() ?? null},first_name),
          last_name=COALESCE(${dto.lastName?.trim() ?? null},last_name),
          phone=CASE WHEN ${dto.phone === undefined} THEN phone ELSE ${dto.phone?.trim() || null} END,
          started_at=COALESCE(${dto.startedAt ?? null}::date,started_at),
          updated_at=now()
        WHERE user_id=${userId}
        RETURNING *
      `);
      const after = result.rows[0] as any;
      await this.audit.record({
        actorUserId: actor.id, actorRoleCode: actor.roles[0], action: "UPDATE_STAFF_PROFILE",
        entityType: "StaffProfile", entityId: userId, requestId,
        beforeData: { firstName: before.first_name, lastName: before.last_name, phone: before.phone, startedAt: before.started_at },
        afterData: { firstName: after.first_name, lastName: after.last_name, phone: after.phone, startedAt: after.started_at },
      }, tx as any);
    });
    return this.getById(userId);
  }

  async changeRole(userId: string, dto: ChangeStaffRoleDto, actor: AuthUser, requestId?: string) {
    if (userId === actor.id) throw new ConflictException({ code: "CANNOT_CHANGE_OWN_ROLE", message: "You cannot change your own role from the Team screen" });
    return this.db.transaction(async (tx) => {
      const profile = await tx.execute(sql`SELECT sp.archived_at FROM staff_profiles sp WHERE sp.user_id=${userId} FOR UPDATE`);
      if (!profile.rowCount) throw new NotFoundException({ code: "STAFF_NOT_FOUND", message: "Staff member not found" });
      if ((profile.rows[0] as any).archived_at) throw new ConflictException({ code: "STAFF_ARCHIVED", message: "Reactivate the staff member before changing their role" });
      const current = await tx.execute(sql`SELECT r.code FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=${userId}`);
      const currentRoles = (current.rows as any[]).map((row) => row.code as string);
      if (currentRoles.includes("ADMIN")) throw new ConflictException({ code: "ADMIN_ROLE_PROTECTED", message: "Admin role cannot be changed from the Team screen" });
      if (currentRoles.includes("MANAGER") && dto.roleCode !== "MANAGER") {
        const assignments = await tx.execute(sql`SELECT 1 FROM student_manager_assignments WHERE manager_user_id=${userId} AND ended_at IS NULL LIMIT 1`);
        if (assignments.rowCount) throw new ConflictException({ code: "MANAGER_HAS_ACTIVE_STUDENTS", message: "Reassign the manager's students before changing their role" });
      }
      await tx.execute(sql`
        DELETE FROM user_roles ur
        USING roles r
        WHERE ur.role_id=r.id AND ur.user_id=${userId} AND r.code IN ('MANAGER','FINANCIER','SUPPORT_MANAGER')
      `);
      await tx.execute(sql`INSERT INTO user_roles(user_id,role_id,assigned_by) SELECT ${userId},id,${actor.id} FROM roles WHERE code=${dto.roleCode}`);
      await this.audit.record({ actorUserId: actor.id, actorRoleCode: actor.roles[0], action: "CHANGE_STAFF_ROLE", entityType: "User", entityId: userId, requestId, beforeData: { roles: currentRoles }, afterData: { role: dto.roleCode } }, tx as any);
      return { ok: true, roleCode: dto.roleCode };
    });
  }

  async archive(userId: string, actor: AuthUser, requestId?: string) {
    if (userId === actor.id) throw new ConflictException({ code: "CANNOT_ARCHIVE_SELF", message: "You cannot archive your own account" });
    return this.db.transaction(async (tx) => {
      const target = await tx.execute(sql`
        SELECT sp.archived_at,u.status
        FROM staff_profiles sp JOIN users u ON u.id=sp.user_id
        WHERE sp.user_id=${userId}
        FOR UPDATE OF sp,u
      `);
      if (!target.rowCount) throw new NotFoundException({ code: "STAFF_NOT_FOUND", message: "Staff member not found" });
      const row = target.rows[0] as any;
      if (row.status === "SUSPENDED") throw new ConflictException({ code: "ACCOUNT_SUSPENDED", message: "Restore the suspended account before archiving it" });
      const roleRows = await tx.execute(sql`SELECT r.code FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=${userId}`);
      const roleList = (roleRows.rows as any[]).map((item) => item.code as string);
      if (roleList.includes("ADMIN")) throw new ConflictException({ code: "ADMIN_ACCOUNT_PROTECTED", message: "Admin accounts cannot be archived from the Team screen" });
      if (row.archived_at) return { ok: true, alreadyArchived: true };
      if (roleList.includes("MANAGER")) {
        const activeStudents = await tx.execute(sql`SELECT COUNT(*)::int count FROM student_manager_assignments WHERE manager_user_id=${userId} AND ended_at IS NULL`);
        if (Number((activeStudents.rows[0] as any)?.count ?? 0) > 0) throw new ConflictException({ code: "MANAGER_HAS_ACTIVE_STUDENTS", message: "Reassign the manager's students before archiving the account" });
      }
      await tx.execute(sql`UPDATE staff_profiles SET archived_at=now(),updated_at=now() WHERE user_id=${userId}`);
      await tx.execute(sql`UPDATE users SET status='ARCHIVED',archived_at=now(),updated_at=now() WHERE id=${userId}`);
      await tx.execute(sql`UPDATE user_sessions SET revoked_at=now() WHERE user_id=${userId} AND revoked_at IS NULL`);
      await this.audit.record({ actorUserId: actor.id, actorRoleCode: actor.roles[0], action: "ARCHIVE_STAFF", entityType: "StaffProfile", entityId: userId, requestId, beforeData: { userStatus: row.status, roles: roleList }, afterData: { userStatus: "ARCHIVED" } }, tx as any);
      return { ok: true };
    });
  }

  async reactivate(userId: string, actor: AuthUser, requestId?: string) {
    await this.db.transaction(async (tx) => {
      const target = await tx.execute(sql`SELECT sp.archived_at,u.password_hash,u.status FROM staff_profiles sp JOIN users u ON u.id=sp.user_id WHERE sp.user_id=${userId} FOR UPDATE OF sp,u`);
      if (!target.rowCount) throw new NotFoundException({ code: "STAFF_NOT_FOUND", message: "Staff member not found" });
      const row = target.rows[0] as any;
      if (!row.archived_at) return { unchanged: true };
      if (row.status === "SUSPENDED") throw new ConflictException({ code: "ACCOUNT_SUSPENDED", message: "Restore the suspended account before reactivating it" });
      const userStatus = row.password_hash ? "ACTIVE" : "PENDING";
      await tx.execute(sql`UPDATE staff_profiles SET archived_at=NULL,updated_at=now() WHERE user_id=${userId}`);
      await tx.execute(sql`UPDATE users SET status=${userStatus}::user_status,archived_at=NULL,updated_at=now() WHERE id=${userId}`);
      await this.audit.record({ actorUserId: actor.id, actorRoleCode: actor.roles[0], action: "REACTIVATE_STAFF", entityType: "StaffProfile", entityId: userId, requestId, afterData: { userStatus } }, tx as any);
    });
    return this.getById(userId);
  }
}
