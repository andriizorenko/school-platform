import { z } from "zod";

export const paymentMethodSchema = z.enum(["CARD", "BANK_TRANSFER", "CASH", "OTHER"]);

export const createSubjectPriceSchema = z.object({
  regular60PriceMinor: z.number().int().min(0),
  firstLessonPriceMinor: z.number().int().min(0),
  currency: z.string().length(3).default("UAH"),
  effectiveFrom: z.string().date(),
  effectiveUntil: z.string().date().optional(),
});

export const manualLessonTopupSchema = z.object({
  lessonUnits: z.number().int().min(1),
  amountMinor: z.number().int().min(0),
  paymentMethod: paymentMethodSchema,
  note: z.string().max(500).optional(),
});

export type CreateSubjectPriceInput = z.infer<typeof createSubjectPriceSchema>;
export type ManualLessonTopupInput = z.infer<typeof manualLessonTopupSchema>;

export const recordFirstLessonPaymentSchema = z.object({
  amountMinor: z.number().int().min(0),
  paymentMethod: paymentMethodSchema,
  note: z.string().max(500).optional(),
});

export const balanceNoteSchema = z.object({
  note: z.string().max(500).optional(),
});

export type RecordFirstLessonPaymentInput = z.infer<typeof recordFirstLessonPaymentSchema>;
export type BalanceNoteInput = z.infer<typeof balanceNoteSchema>;

export const onlinePaymentProviderSchema = z.enum(["LIQPAY", "MONO"]);

export const parentLessonCheckoutSchema = z.object({
  lessonUnits: z.number().int().min(1),
  promotionCode: z.string().trim().max(80).optional(),
  paymentProvider: onlinePaymentProviderSchema.optional(),
  idempotencyKey: z.string().uuid().optional(),
});

export type ParentLessonCheckoutInput = z.infer<typeof parentLessonCheckoutSchema>;
