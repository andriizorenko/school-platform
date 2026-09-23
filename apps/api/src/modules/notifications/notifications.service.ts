import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  notificationEventRoles,
  notificationEventTypes,
  notificationPreferences,
  notifications,
  telegramConnections,
  telegramLinkTokens,
} from "@school/db";
import type { Database } from "@school/db";
import { and, desc, eq, gt, inArray, ne, or } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { DATABASE } from "../../common/database/database.constants";
import type { AuthUser } from "../auth/types";
import type { UpdateNotificationPreferenceDto } from "./dto/update-notification-preference.dto";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly config: ConfigService,
  ) {}

  async list(userId: string, limit = 20) {
    const safeLimit = Math.max(1, Math.min(limit, 100));
    return this.db
      .select({
        id: notifications.id,
        eventType: notifications.eventType,
        description: notificationEventTypes.description,
        status: notifications.status,
        payload: notifications.payload,
        sentAt: notifications.sentAt,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .innerJoin(notificationEventTypes, eq(notificationEventTypes.code, notifications.eventType))
      .where(and(eq(notifications.userId, userId), ne(notifications.status, "CANCELLED")))
      .orderBy(desc(notifications.createdAt))
      .limit(safeLimit);
  }

  async markRead(notificationId: string, userId: string) {
    const [row] = await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
      .returning();
    if (!row) throw new NotFoundException({ code: "NOTIFICATION_NOT_FOUND", message: "Notification not found" });
    return row;
  }

  async markAllRead(userId: string) {
    const rows = await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), ne(notifications.status, "CANCELLED")))
      .returning({ id: notifications.id });
    return { updated: rows.length };
  }

  private async allowedEventCodes(roles: string[]) {
    if (!roles.length) return [] as string[];
    const rows = await this.db
      .select({ eventType: notificationEventRoles.eventType })
      .from(notificationEventRoles)
      .where(inArray(notificationEventRoles.roleCode, roles));
    return [...new Set(rows.map((row) => row.eventType))];
  }

  async getPreferences(userId: string, roles: string[]) {
    const allowedCodes = await this.allowedEventCodes(roles);
    if (!allowedCodes.length) return [];

    const eventTypes = await this.db
      .select()
      .from(notificationEventTypes)
      .where(inArray(notificationEventTypes.code, allowedCodes))
      .orderBy(notificationEventTypes.code);
    const preferences = await this.db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId));

    const byKey = new Map(preferences.map((item) => [`${item.eventType}:${item.channel}`, item.enabled]));
    return eventTypes.map((eventType) => ({
      eventType: eventType.code,
      description: eventType.description,
      userConfigurable: eventType.userConfigurable,
      channels: {
        TELEGRAM: byKey.get(`${eventType.code}:TELEGRAM`) ?? eventType.defaultEnabled,
        EMAIL: byKey.get(`${eventType.code}:EMAIL`) ?? eventType.defaultEnabled,
      },
    }));
  }

  async updatePreference(user: AuthUser, dto: UpdateNotificationPreferenceDto) {
    const [eventType] = await this.db
      .select()
      .from(notificationEventTypes)
      .where(eq(notificationEventTypes.code, dto.eventType))
      .limit(1);
    if (!eventType) {
      throw new NotFoundException({ code: "NOTIFICATION_EVENT_NOT_FOUND", message: "Notification event type not found" });
    }

    const [audience] = user.roles.length
      ? await this.db
          .select({ eventType: notificationEventRoles.eventType })
          .from(notificationEventRoles)
          .where(
            and(
              eq(notificationEventRoles.eventType, dto.eventType),
              inArray(notificationEventRoles.roleCode, user.roles),
            ),
          )
          .limit(1)
      : [];
    if (!audience) {
      throw new ForbiddenException({ code: "NOTIFICATION_EVENT_NOT_AVAILABLE", message: "Notification is not available for this role" });
    }

    if (!eventType.userConfigurable) {
      throw new ConflictException({
        code: "NOTIFICATION_EVENT_REQUIRED",
        message: "This notification cannot be disabled",
      });
    }

    const [preference] = await this.db
      .insert(notificationPreferences)
      .values({ userId: user.id, eventType: dto.eventType, channel: dto.channel, enabled: dto.enabled })
      .onConflictDoUpdate({
        target: [notificationPreferences.userId, notificationPreferences.eventType, notificationPreferences.channel],
        set: { enabled: dto.enabled, updatedAt: new Date() },
      })
      .returning();
    return preference;
  }

  async telegramStatus(userId: string) {
    const [connection] = await this.db
      .select({
        username: telegramConnections.username,
        status: telegramConnections.status,
        connectedAt: telegramConnections.connectedAt,
        disconnectedAt: telegramConnections.disconnectedAt,
      })
      .from(telegramConnections)
      .where(eq(telegramConnections.userId, userId))
      .limit(1);
    return connection ?? { status: "DISCONNECTED", username: null, connectedAt: null, disconnectedAt: null };
  }

  async createTelegramLink(userId: string) {
    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = sha256(rawToken);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await this.db.insert(telegramLinkTokens).values({ userId, tokenHash, expiresAt });

    const botUsername = this.config.get<string>("TELEGRAM_BOT_USERNAME")?.replace(/^@/, "");
    return {
      expiresAt,
      token: rawToken,
      deepLink: botUsername ? `https://t.me/${botUsername}?start=${rawToken}` : null,
    };
  }

  async disconnectTelegram(userId: string) {
    const [connection] = await this.db
      .update(telegramConnections)
      .set({ status: "DISCONNECTED", disconnectedAt: new Date() })
      .where(eq(telegramConnections.userId, userId))
      .returning({ userId: telegramConnections.userId, status: telegramConnections.status });
    return connection ?? { userId, status: "DISCONNECTED" as const };
  }

  async connectFromTelegramStart(input: {
    token: string;
    telegramUserId: bigint;
    telegramChatId: bigint;
    username?: string;
  }) {
    const tokenHash = sha256(input.token);

    return this.db.transaction(async (tx) => {
      const [link] = await tx
        .select()
        .from(telegramLinkTokens)
        .where(and(eq(telegramLinkTokens.tokenHash, tokenHash), gt(telegramLinkTokens.expiresAt, new Date())))
        .limit(1);
      if (!link || link.usedAt) {
        throw new ConflictException({ code: "TELEGRAM_LINK_INVALID", message: "Telegram link is invalid or expired" });
      }

      const [telegramOwner] = await tx
        .select({ userId: telegramConnections.userId })
        .from(telegramConnections)
        .where(
          or(
            eq(telegramConnections.telegramUserId, input.telegramUserId),
            eq(telegramConnections.telegramChatId, input.telegramChatId),
          ),
        )
        .limit(1);
      if (telegramOwner && telegramOwner.userId !== link.userId) {
        throw new ConflictException({
          code: "TELEGRAM_ACCOUNT_ALREADY_LINKED",
          message: "This Telegram account is already linked to another platform account",
        });
      }

      const [connection] = await tx
        .insert(telegramConnections)
        .values({
          userId: link.userId,
          telegramUserId: input.telegramUserId,
          telegramChatId: input.telegramChatId,
          username: input.username,
          status: "ACTIVE",
          connectedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: telegramConnections.userId,
          set: {
            telegramUserId: input.telegramUserId,
            telegramChatId: input.telegramChatId,
            username: input.username,
            status: "ACTIVE",
            connectedAt: new Date(),
            disconnectedAt: null,
          },
        })
        .returning();

      await tx.update(telegramLinkTokens).set({ usedAt: new Date() }).where(eq(telegramLinkTokens.id, link.id));

      return {
        userId: connection.userId,
        username: connection.username,
        status: connection.status,
        connectedAt: connection.connectedAt,
      };
    });
  }
}
