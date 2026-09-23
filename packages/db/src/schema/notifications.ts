import { sql } from "drizzle-orm";
import { bigint, boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { outboxEvents } from "./audit.js";
import { roles } from "./iam.js";

export const notificationChannelEnum = pgEnum("notification_channel", ["TELEGRAM", "EMAIL"]);
export const notificationStatusEnum = pgEnum("notification_status", ["PENDING", "PROCESSING", "SENT", "FAILED", "CANCELLED"]);
export const notificationDeliveryStatusEnum = pgEnum("notification_delivery_status", ["PENDING", "SENT", "FAILED", "SKIPPED"]);
export const telegramConnectionStatusEnum = pgEnum("telegram_connection_status", ["ACTIVE", "DISCONNECTED"]);

export const notificationEventTypes = pgTable("notification_event_types", {
  code: text("code").primaryKey(),
  userConfigurable: boolean("user_configurable").notNull().default(true),
  defaultEnabled: boolean("default_enabled").notNull().default(true),
  description: text("description"),
});

export const notificationEventRoles = pgTable(
  "notification_event_roles",
  {
    eventType: text("event_type").notNull().references(() => notificationEventTypes.code, { onDelete: "cascade" }),
    roleCode: text("role_code").notNull().references(() => roles.code, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.eventType, table.roleCode] }),
    index("notification_event_roles_role_idx").on(table.roleCode, table.eventType),
  ],
);

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull().references(() => notificationEventTypes.code, { onDelete: "restrict" }),
    channel: notificationChannelEnum("channel").notNull(),
    enabled: boolean("enabled").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.eventType, table.channel] })],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    eventType: text("event_type").notNull().references(() => notificationEventTypes.code, { onDelete: "restrict" }),
    sourceOutboxEventId: uuid("source_outbox_event_id").references(() => outboxEvents.id, { onDelete: "restrict" }),
    dedupKey: text("dedup_key"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull().defaultNow(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    status: notificationStatusEnum("status").notNull().default("PENDING"),
    payload: jsonb("payload").notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("notifications_outbox_user_uidx")
      .on(table.sourceOutboxEventId, table.userId)
      .where(sql`${table.sourceOutboxEventId} IS NOT NULL`),
    uniqueIndex("notifications_user_event_dedup_uidx")
      .on(table.userId, table.eventType, table.dedupKey)
      .where(sql`${table.dedupKey} IS NOT NULL`),
    index("notifications_user_created_idx").on(table.userId, table.createdAt),
    index("notifications_status_scheduled_idx").on(table.status, table.scheduledAt),
    index("notifications_due_retry_idx").on(table.status, table.nextAttemptAt, table.scheduledAt),
    index("notifications_expires_idx").on(table.expiresAt),
  ],
);

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    notificationId: uuid("notification_id").notNull().references(() => notifications.id, { onDelete: "restrict" }),
    channel: notificationChannelEnum("channel").notNull(),
    status: notificationDeliveryStatusEnum("status").notNull().default("PENDING"),
    provider: text("provider"),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("notification_deliveries_notification_idx").on(table.notificationId, table.attemptedAt)],
);

export const telegramConnections = pgTable("telegram_connections", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  telegramUserId: bigint("telegram_user_id", { mode: "bigint" }).notNull().unique(),
  telegramChatId: bigint("telegram_chat_id", { mode: "bigint" }).notNull().unique(),
  username: text("username"),
  status: telegramConnectionStatusEnum("status").notNull().default("ACTIVE"),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
});

export const telegramLinkTokens = pgTable(
  "telegram_link_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("telegram_link_tokens_user_expires_idx").on(table.userId, table.expiresAt)],
);
