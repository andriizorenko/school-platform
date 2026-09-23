import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { userSessions, users } from "@school/db";
import type { Database } from "@school/db";
import argon2 from "argon2";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database/database.constants";
import { IamService } from "../iam/iam.service";

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly iam: IamService,
  ) {}

  private hashToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }

  async login(email: string, password: string, userAgent?: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.db.query.users.findFirst({
      where: eq(users.email, normalizedEmail),
    });

    if (!user?.passwordHash || user.status !== "ACTIVE") {
      throw new UnauthorizedException("Invalid email or password");
    }

    const passwordMatches = await argon2.verify(user.passwordHash, password);
    if (!passwordMatches) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const token = randomBytes(32).toString("base64url");
    const tokenHash = this.hashToken(token);
    const ttlDays = Number(this.config.get<string>("SESSION_TTL_DAYS", "30"));
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

    const access = await this.iam.getUserAccess(user.id);
    const privilegedMfa = access.roles.some((role) => ["ADMIN", "FINANCIER", "SUPPORT_MANAGER"].includes(role));
    const mfaMethod = privilegedMfa
      ? await this.db.execute(sql`SELECT enabled_at FROM mfa_methods WHERE user_id = ${user.id} AND type = 'TOTP' LIMIT 1`)
      : null;
    const mfaEnabled = Boolean((mfaMethod?.rows?.[0] as any)?.enabled_at);

    const [session] = await this.db
      .insert(userSessions)
      .values({
        userId: user.id,
        tokenHash,
        userAgent,
        expiresAt,
        mfaVerifiedAt: privilegedMfa ? null : new Date(),
      })
      .returning({ id: userSessions.id });

    await this.db
      .update(users)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, user.id));

    return {
      token,
      sessionId: session.id,
      expiresAt,
      mfaRequired: privilegedMfa && mfaEnabled,
      mfaSetupRequired: privilegedMfa && !mfaEnabled,
      user: {
        id: user.id,
        email: user.email,
        ...access,
      },
    };
  }

  async authenticateToken(token: string) {
    const tokenHash = this.hashToken(token);
    const now = new Date();

    const [row] = await this.db
      .select({
        sessionId: userSessions.id,
        userId: users.id,
        email: users.email,
        status: users.status,
        lastUsedAt: userSessions.lastUsedAt,
        mfaVerifiedAt: userSessions.mfaVerifiedAt,
      })
      .from(userSessions)
      .innerJoin(users, eq(userSessions.userId, users.id))
      .where(
        and(
          eq(userSessions.tokenHash, tokenHash),
          isNull(userSessions.revokedAt),
          gt(userSessions.expiresAt, now),
        ),
      )
      .limit(1);

    if (!row || row.status !== "ACTIVE") {
      throw new UnauthorizedException("Session is invalid or expired");
    }

    if (now.getTime() - row.lastUsedAt.getTime() > 5 * 60 * 1000) {
      await this.db
        .update(userSessions)
        .set({ lastUsedAt: now })
        .where(eq(userSessions.id, row.sessionId));
    }

    const access = await this.iam.getUserAccess(row.userId);

    return {
      sessionId: row.sessionId,
      mfaVerified: Boolean(row.mfaVerifiedAt),
      user: {
        id: row.userId,
        email: row.email,
        ...access,
      },
    };
  }

  async listSessions(userId: string, currentSessionId?: string) {
    const rows = await this.db
      .select({
        id: userSessions.id,
        userAgent: userSessions.userAgent,
        deviceName: userSessions.deviceName,
        createdAt: userSessions.createdAt,
        lastUsedAt: userSessions.lastUsedAt,
        expiresAt: userSessions.expiresAt,
        revokedAt: userSessions.revokedAt,
      })
      .from(userSessions)
      .where(eq(userSessions.userId, userId));
    return rows
      .filter((row) => !row.revokedAt && row.expiresAt.getTime() > Date.now())
      .sort((a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime())
      .map((row) => ({ ...row, current: row.id === currentSessionId }));
  }

  async revokeSession(userId: string, sessionId: string) {
    const [row] = await this.db
      .update(userSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(userSessions.id, sessionId), eq(userSessions.userId, userId), isNull(userSessions.revokedAt)))
      .returning({ id: userSessions.id });
    return { ok: Boolean(row) };
  }

  async logout(sessionId: string) {
    await this.db
      .update(userSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(userSessions.id, sessionId), isNull(userSessions.revokedAt)));
  }
}
