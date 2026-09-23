import { z } from "zod";

export const notificationChannelSchema = z.enum(["TELEGRAM", "EMAIL"]);

export const updateNotificationPreferenceSchema = z.object({
  eventType: z.string().min(1),
  channel: notificationChannelSchema,
  enabled: z.boolean(),
});

export const notificationPreferenceSchema = z.object({
  eventType: z.string(),
  description: z.string().nullable().optional(),
  userConfigurable: z.boolean(),
  channels: z.object({
    TELEGRAM: z.boolean(),
    EMAIL: z.boolean(),
  }),
});

export const notificationHistoryItemSchema = z.object({
  id: z.string().uuid(),
  eventType: z.string(),
  description: z.string().nullable().optional(),
  status: z.enum(["PENDING", "PROCESSING", "SENT", "FAILED", "CANCELLED"]),
  payload: z.record(z.string(), z.unknown()),
  sentAt: z.string().nullable().optional(),
  readAt: z.string().nullable().optional(),
  createdAt: z.string(),
});

export type UpdateNotificationPreferenceInput = z.infer<typeof updateNotificationPreferenceSchema>;
export type NotificationPreference = z.infer<typeof notificationPreferenceSchema>;
export type NotificationHistoryItem = z.infer<typeof notificationHistoryItemSchema>;
