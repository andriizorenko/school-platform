import { createHash, randomBytes } from "node:crypto";
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import type { Database } from "@school/db";
import { sql } from "drizzle-orm";
import argon2 from "argon2";
import { DATABASE } from "../../common/database/database.constants";
import type { AuthUser } from "../auth/types";
import { AuditService } from "../audit/audit.service";
import { OutboxService } from "../audit/outbox.service";
import { isPgUniqueViolation } from "../../common/database/pg-errors";
import type { UpdateMyProfileDto } from "./dto/update-my-profile.dto";

@Injectable()
export class AccountsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  private hash(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }


  async getMyProfile(userId: string) {
    const result = await this.db.execute(sql`
      SELECT u.id, u.email, u.telegram_username,
        COALESCE(pp.first_name, tp.first_name, sp.first_name, st.first_name) AS first_name,
        COALESCE(pp.last_name, tp.last_name, sp.last_name, st.last_name) AS last_name,
        COALESCE(pp.phone, tp.phone, sp.phone, u.contact_phone) AS phone
      FROM users u
      LEFT JOIN parent_profiles pp ON pp.user_id = u.id
      LEFT JOIN teacher_profiles tp ON tp.user_id = u.id
      LEFT JOIN staff_profiles sp ON sp.user_id = u.id
      LEFT JOIN students st ON st.user_id = u.id
      WHERE u.id = ${userId}
      LIMIT 1
    `);
    if (!result.rowCount) throw new NotFoundException({ code: "USER_NOT_FOUND", message: "User not found" });
    const row = result.rows[0] as any;
    return {
      firstName: row.first_name ?? "",
      lastName: row.last_name ?? "",
      email: row.email,
      phone: row.phone ?? "",
      telegramUsername: row.telegram_username ?? "",
    };
  }

  async updateMyProfile(dto: UpdateMyProfileDto, actor: AuthUser, requestId?: string) {
    const firstName = dto.firstName.trim();
    const lastName = dto.lastName.trim();
    const phone = dto.phone.trim();
    const email = dto.email.trim().toLowerCase();
    const telegramUsername = dto.telegramUsername.trim().replace(/^@/, "");
    if (!firstName || !lastName) {
      throw new BadRequestException({ code: "PROFILE_NAME_REQUIRED", message: "First and last name are required" });
    }
    try {
      await this.db.transaction(async (tx) => {
        const locked = await tx.execute(sql`SELECT email,password_hash FROM users WHERE id=${actor.id} FOR UPDATE`);
        if (!locked.rowCount) throw new NotFoundException({ code: "USER_NOT_FOUND", message: "User not found" });
        const current = locked.rows[0] as { email: string; password_hash: string | null };
        const emailChanged = current.email.toLowerCase() !== email;
        if (emailChanged) {
          if (!current.password_hash || !dto.currentPassword || !(await argon2.verify(current.password_hash, dto.currentPassword))) {
            throw new UnauthorizedException({ code: "CURRENT_PASSWORD_INVALID", message: "Confirm the current password to change email" });
          }
          const duplicate = await tx.execute(sql`SELECT 1 FROM users WHERE email=${email} AND id<>${actor.id} LIMIT 1`);
          if (duplicate.rowCount) throw new ConflictException({ code: "EMAIL_ALREADY_IN_USE", message: "Email is already in use" });
        }
        if (!phone) {
          const requiredPhone = await tx.execute(sql`
            SELECT EXISTS(SELECT 1 FROM parent_profiles WHERE user_id=${actor.id})
              OR EXISTS(SELECT 1 FROM teacher_profiles WHERE user_id=${actor.id}) AS required
          `);
          if ((requiredPhone.rows[0] as any).required) {
            throw new BadRequestException({ code: "PROFILE_PHONE_REQUIRED", message: "Phone is required for this account" });
          }
        }
        await tx.execute(sql`
          UPDATE users SET email=${email}, contact_phone=${phone || null},
            telegram_username=${telegramUsername || null},
            email_verified_at=CASE WHEN ${emailChanged} THEN NULL ELSE email_verified_at END,
            updated_at=now() WHERE id=${actor.id}
        `);
        await tx.execute(sql`UPDATE parent_profiles SET first_name=${firstName},last_name=${lastName},phone=${phone},updated_at=now() WHERE user_id=${actor.id}`);
        await tx.execute(sql`UPDATE teacher_profiles SET first_name=${firstName},last_name=${lastName},phone=${phone},updated_at=now() WHERE user_id=${actor.id}`);
        await tx.execute(sql`UPDATE staff_profiles SET first_name=${firstName},last_name=${lastName},phone=${phone || null},updated_at=now() WHERE user_id=${actor.id}`);
        await tx.execute(sql`UPDATE students SET first_name=${firstName},last_name=${lastName},updated_at=now() WHERE user_id=${actor.id}`);
        await this.audit.record({
          actorUserId: actor.id,
          actorRoleCode: actor.roles[0],
          action: "UPDATE_OWN_PROFILE",
          entityType: "User",
          entityId: actor.id,
          requestId,
          beforeData: { email: current.email },
          afterData: { email, firstName, lastName, phone, telegramUsername, emailChanged },
        }, tx as any);
      });
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        throw new ConflictException({ code: "EMAIL_ALREADY_IN_USE", message: "Email is already in use" });
      }
      throw error;
    }
    return this.getMyProfile(actor.id);
  }

  async invite(userId: string, actor: AuthUser, requestId?: string) {
    return this.db.transaction(async (tx) => {
      const result = await tx.execute(sql`SELECT id,email,status,password_hash FROM users WHERE id=${userId} FOR UPDATE`);
      if (!result.rowCount) throw new NotFoundException({ code: "USER_NOT_FOUND", message: "User not found" });
      const user = result.rows[0] as any;
      if (user.status === "ARCHIVED") throw new ConflictException({ code: "ACCOUNT_ARCHIVED", message: "Reactivate the account before sending an invitation" });
      if (user.status === "SUSPENDED") throw new ConflictException({ code: "ACCOUNT_SUSPENDED", message: "Restore the account before sending an invitation" });
      if (user.status === "ACTIVE" && user.password_hash) throw new ConflictException({ code: "ACCOUNT_ALREADY_ACTIVE", message: "This account is already active" });

      const token = randomBytes(32).toString("base64url");
      const tokenHash = this.hash(token);
      const expiresAt = new Date(Date.now() + 72 * 3600_000);
      await tx.execute(sql`UPDATE user_invitations SET accepted_at=COALESCE(accepted_at,now()) WHERE user_id=${userId} AND accepted_at IS NULL`);
      await tx.execute(sql`INSERT INTO user_invitations(user_id,token_hash,expires_at,created_by) VALUES(${userId},${tokenHash},${expiresAt},${actor.id})`);
      await this.outbox.publish({
        eventType: "EMAIL_INVITATION",
        aggregateType: "User",
        aggregateId: userId,
        payload: { email: user.email, token },
      }, tx as any);
      await this.audit.record({
        actorUserId: actor.id,
        actorRoleCode: actor.roles[0],
        action: "SEND_USER_INVITATION",
        entityType: "User",
        entityId: userId,
        requestId,
        afterData: { email: user.email, expiresAt },
      }, tx as any);
      return { ok: true, expiresAt };
    });
  }

  async acceptInvitation(token: string, password: string) {
    const tokenHash = this.hash(token);
    return this.db.transaction(async (tx) => {
      const result = await tx.execute(sql`
        SELECT i.id,i.user_id,u.email,u.status
        FROM user_invitations i JOIN users u ON u.id=i.user_id
        WHERE i.token_hash=${tokenHash} AND i.accepted_at IS NULL AND i.expires_at>now()
        FOR UPDATE OF i,u
      `);
      if (!result.rowCount) throw new NotFoundException({ code: "INVITATION_INVALID", message: "Invitation is invalid or expired" });
      const row = result.rows[0] as any;
      if (["ARCHIVED", "SUSPENDED"].includes(row.status)) throw new ConflictException({ code: "ACCOUNT_NOT_AVAILABLE", message: "This account is not available for activation" });
      const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
      await tx.execute(sql`UPDATE users SET password_hash=${passwordHash},status='ACTIVE',email_verified_at=COALESCE(email_verified_at,now()),updated_at=now() WHERE id=${row.user_id}`);
      await tx.execute(sql`UPDATE user_invitations SET accepted_at=now() WHERE id=${row.id}`);
      await tx.execute(sql`UPDATE teacher_profiles SET status=CASE WHEN status='INVITED' THEN 'ACTIVE'::teacher_status ELSE status END,started_at=COALESCE(started_at,current_date),updated_at=now() WHERE user_id=${row.user_id}`);
      return { ok: true, email: row.email };
    });
  }

  async forgot(email: string) {
    const result = await this.db.execute(sql`SELECT id,email FROM users WHERE email=${email.trim().toLowerCase()} AND status='ACTIVE'`);
    if (!result.rowCount) return { ok: true };
    const user = result.rows[0] as any;
    const token = randomBytes(32).toString("base64url");
    const tokenHash = this.hash(token);
    const expiresAt = new Date(Date.now() + 30 * 60_000);
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`UPDATE password_reset_tokens SET used_at=now() WHERE user_id=${user.id} AND used_at IS NULL`);
      await tx.execute(sql`INSERT INTO password_reset_tokens(user_id,token_hash,expires_at) VALUES(${user.id},${tokenHash},${expiresAt})`);
      await this.outbox.publish({ eventType: "EMAIL_PASSWORD_RESET", aggregateType: "User", aggregateId: user.id, payload: { email: user.email, token } }, tx as any);
    });
    return { ok: true };
  }

  async reset(token: string, password: string) {
    const tokenHash = this.hash(token);
    return this.db.transaction(async (tx) => {
      const result = await tx.execute(sql`SELECT id,user_id FROM password_reset_tokens WHERE token_hash=${tokenHash} AND used_at IS NULL AND expires_at>now() FOR UPDATE`);
      if (!result.rowCount) throw new NotFoundException({ code: "RESET_TOKEN_INVALID", message: "Reset link is invalid or expired" });
      const row = result.rows[0] as any;
      const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
      await tx.execute(sql`UPDATE users SET password_hash=${passwordHash},updated_at=now() WHERE id=${row.user_id}`);
      await tx.execute(sql`UPDATE password_reset_tokens SET used_at=now() WHERE id=${row.id}`);
      await tx.execute(sql`UPDATE user_sessions SET revoked_at=now() WHERE user_id=${row.user_id} AND revoked_at IS NULL`);
      return { ok: true };
    });
  }

  async suspend(userId: string, reason: string, actor: AuthUser, requestId?: string) {
    return this.db.transaction(async (tx) => {
      const result = await tx.execute(sql`
        UPDATE users SET status='SUSPENDED',suspended_at=now(),suspended_by=${actor.id},suspension_reason=${reason},updated_at=now()
        WHERE id=${userId} RETURNING id,email,status
      `);
      if (!result.rowCount) throw new NotFoundException();
      await tx.execute(sql`UPDATE user_sessions SET revoked_at=now() WHERE user_id=${userId} AND revoked_at IS NULL`);
      await this.audit.record({ actorUserId: actor.id, actorRoleCode: actor.roles[0], action: "SUSPEND_USER", entityType: "User", entityId: userId, afterData: { reason }, requestId }, tx as any);
      return result.rows[0];
    });
  }

  async restore(userId: string, actor: AuthUser, requestId?: string) {
    return this.db.transaction(async (tx) => {
      const result = await tx.execute(sql`
        UPDATE users SET status=CASE WHEN archived_at IS NOT NULL THEN 'ARCHIVED'::user_status WHEN password_hash IS NULL THEN 'PENDING'::user_status ELSE 'ACTIVE'::user_status END,
          suspended_at=NULL,suspended_by=NULL,suspension_reason=NULL,updated_at=now()
        WHERE id=${userId} AND status='SUSPENDED' RETURNING id,email,status
      `);
      if (!result.rowCount) throw new NotFoundException();
      await this.audit.record({ actorUserId: actor.id, actorRoleCode: actor.roles[0], action: "RESTORE_USER", entityType: "User", entityId: userId, requestId }, tx as any);
      return result.rows[0];
    });
  }

  async createStudentAccount(studentId: string, email: string, actor: AuthUser, requestId?: string) {
    return this.db.transaction(async (tx) => {
      const studentResult = await tx.execute(sql`SELECT id,user_id,first_name,last_name,archived_at FROM students WHERE id=${studentId} FOR UPDATE`);
      if (!studentResult.rowCount) throw new NotFoundException({ code: "STUDENT_NOT_FOUND", message: "Student not found" });
      const student = studentResult.rows[0] as any;
      if (student.archived_at) throw new ConflictException({ code: "STUDENT_ARCHIVED", message: "Reactivate the student before creating an account" });
      if (student.user_id) throw new ConflictException({ code: "STUDENT_ACCOUNT_EXISTS", message: "Student already has an account" });
      const normalizedEmail = email.trim().toLowerCase();
      const user = await tx.execute(sql`INSERT INTO users(email,status) VALUES(${normalizedEmail},'PENDING') RETURNING id,email`);
      const created = user.rows[0] as any;
      await tx.execute(sql`INSERT INTO user_roles(user_id,role_id,assigned_by) SELECT ${created.id},id,${actor.id} FROM roles WHERE code='STUDENT'`);
      await tx.execute(sql`UPDATE students SET user_id=${created.id},updated_at=now() WHERE id=${studentId}`);
      await this.audit.record({ actorUserId: actor.id, actorRoleCode: actor.roles[0], action: "CREATE_STUDENT_ACCOUNT", entityType: "Student", entityId: studentId, afterData: { userId: created.id, email: created.email }, requestId }, tx as any);
      return { studentId, user: created };
    });
  }
}
