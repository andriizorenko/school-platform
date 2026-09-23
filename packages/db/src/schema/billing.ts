import {
  bigint,
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { families } from "./families.js";
import { studentSubjectEnrollments } from "./enrollments.js";
import { liveSessions } from "./scheduling.js";
import { subjects } from "./subjects.js";
import { teacherProfiles } from "./teachers.js";

export const subjectPriceVersions = pgTable(
  "subject_price_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "restrict" }),
    regular60PriceMinor: bigint("regular_60_price_minor", { mode: "number" }).notNull(),
    firstLessonPriceMinor: bigint("first_lesson_price_minor", { mode: "number" }).notNull(),
    currency: char("currency", { length: 3 }).notNull().default("UAH"),
    effectiveFrom: date("effective_from").notNull(),
    effectiveUntil: date("effective_until"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("subject_price_versions_lookup_idx").on(table.subjectId, table.effectiveFrom)],
);

export const orderStatusEnum = pgEnum("order_status", [
  "DRAFT",
  "PENDING_PAYMENT",
  "PAID",
  "CANCELLED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
]);
export const orderSourceEnum = pgEnum("order_source", ["ONLINE", "MANAGER"]);
export const paymentStatusEnum = pgEnum("payment_status", [
  "PENDING",
  "SUCCEEDED",
  "FAILED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
]);
export const paymentMethodEnum = pgEnum("payment_method", ["CARD", "BANK_TRANSFER", "CASH", "OTHER"]);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "restrict" }),
    source: orderSourceEnum("source").notNull(),
    status: orderStatusEnum("status").notNull(),
    currency: char("currency", { length: 3 }).notNull().default("UAH"),
    subtotalMinor: bigint("subtotal_minor", { mode: "number" }).notNull(),
    discountMinor: bigint("discount_minor", { mode: "number" }).notNull().default(0),
    totalMinor: bigint("total_minor", { mode: "number" }).notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
  },
  (table) => [index("orders_family_idx").on(table.familyId, table.createdAt)],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: char("currency", { length: 3 }).notNull().default("UAH"),
    method: paymentMethodEnum("method").notNull(),
    status: paymentStatusEnum("status").notNull(),
    provider: text("provider"),
    providerPaymentId: text("provider_payment_id"),
    providerStatus: text("provider_status"),
    providerUpdatedAt: timestamp("provider_updated_at", { withTimezone: true }),
    providerCheckoutUrl: text("provider_checkout_url"),
    refundedMinor: bigint("refunded_minor", { mode: "number" }).notNull().default(0),
    recordedBy: uuid("recorded_by").references(() => users.id, { onDelete: "restrict" }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("payments_order_idx").on(table.orderId, table.createdAt),
    uniqueIndex("payments_order_provider_uidx").on(table.orderId, table.provider),
    uniqueIndex("payments_provider_payment_uidx").on(table.provider, table.providerPaymentId),
  ],
);

export const paymentRefundStatusEnum = pgEnum("payment_refund_status", ["PENDING", "SUCCEEDED", "FAILED"]);

export const paymentRefunds = pgTable(
  "payment_refunds",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "restrict" }),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    creditsToRevoke: integer("credits_to_revoke").notNull(),
    status: paymentRefundStatusEnum("status").notNull().default("PENDING"),
    provider: text("provider").notNull(),
    providerRefundId: text("provider_refund_id"),
    providerStatus: text("provider_status"),
    idempotencyKey: text("idempotency_key"),
    reason: text("reason"),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "restrict" }),
    providerResponse: jsonb("provider_response"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("payment_refunds_idempotency_uidx").on(table.idempotencyKey),
    index("payment_refunds_payment_idx").on(table.paymentId, table.createdAt),
  ],
);

export const paymentProviderEvents = pgTable(
  "payment_provider_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").notNull(),
    eventHash: text("event_hash").notNull(),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "restrict" }),
    providerPaymentId: text("provider_payment_id"),
    providerStatus: text("provider_status"),
    providerUpdatedAt: timestamp("provider_updated_at", { withTimezone: true }),
    payload: jsonb("payload").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    processingError: text("processing_error"),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
    reconciledBy: uuid("reconciled_by").references(() => users.id, { onDelete: "restrict" }),
    reconciliationNote: text("reconciliation_note"),
  },
  (table) => [
    uniqueIndex("payment_provider_events_hash_uidx").on(table.provider, table.eventHash),
    index("payment_provider_events_order_idx").on(table.orderId, table.receivedAt),
  ],
);


export const orderPromotions = pgTable(
  "order_promotions",
  {
    orderId: uuid("order_id")
      .primaryKey()
      .references(() => orders.id, { onDelete: "restrict" }),
    promotionId: uuid("promotion_id"),
    promotionNameSnapshot: text("promotion_name_snapshot").notNull(),
    discountType: text("discount_type").notNull(),
    discountValue: bigint("discount_value", { mode: "number" }).notNull(),
    discountMinor: bigint("discount_minor", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("order_promotions_promotion_idx").on(table.promotionId, table.createdAt)],
);

export const lessonCheckoutIntents = pgTable(
  "lesson_checkout_intents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    enrollmentId: uuid("enrollment_id")
      .notNull()
      .references(() => studentSubjectEnrollments.id, { onDelete: "restrict" }),
    subjectPriceVersionId: uuid("subject_price_version_id")
      .notNull()
      .references(() => subjectPriceVersions.id, { onDelete: "restrict" }),
    lessonUnits: integer("lesson_units").notNull(),
    creditsToGrant: integer("credits_to_grant").notNull(),
    baseUnitPriceMinor: bigint("base_unit_price_minor", { mode: "number" }).notNull(),
    baseTotalMinor: bigint("base_total_minor", { mode: "number" }).notNull(),
    discountMinor: bigint("discount_minor", { mode: "number" }).notNull().default(0),
    finalTotalMinor: bigint("final_total_minor", { mode: "number" }).notNull(),
    promotionId: uuid("promotion_id"),
    idempotencyKey: text("idempotency_key"),
    paymentProvider: text("payment_provider"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("lesson_checkout_intents_order_uidx").on(table.orderId),
    uniqueIndex("lesson_checkout_idempotency_uidx").on(table.idempotencyKey),
    index("lesson_checkout_enrollment_idx").on(table.enrollmentId, table.createdAt),
  ],
);

export const lessonTopups = pgTable(
  "lesson_topups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    enrollmentId: uuid("enrollment_id")
      .notNull()
      .references(() => studentSubjectEnrollments.id, { onDelete: "restrict" }),
    subjectPriceVersionId: uuid("subject_price_version_id").references(() => subjectPriceVersions.id, {
      onDelete: "restrict",
    }),
    lessonUnits: integer("lesson_units").notNull(),
    creditsGranted: integer("credits_granted").notNull(),
    baseUnitPriceMinor: bigint("base_unit_price_minor", { mode: "number" }).notNull(),
    finalTotalMinor: bigint("final_total_minor", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("lesson_topups_order_uidx").on(table.orderId),
    index("lesson_topups_enrollment_idx").on(table.enrollmentId, table.createdAt),
  ],
);

export const creditGrantTypeEnum = pgEnum("credit_grant_type", [
  "PURCHASE",
  "TEACHER_COMPENSATION",
  "TRANSFER_IN",
  "MANUAL_ADJUSTMENT",
]);
export const creditDebitTypeEnum = pgEnum("credit_debit_type", [
  "LESSON_COMPLETED",
  "NO_SHOW_CHARGED",
  "TRANSFER_OUT",
  "WRITE_OFF",
  "MANUAL_ADJUSTMENT",
  "PURCHASE_REFUND",
]);
export const creditReservationStatusEnum = pgEnum("credit_reservation_status", ["ACTIVE", "CONSUMED", "RELEASED"]);

export const lessonCreditGrants = pgTable(
  "lesson_credit_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    enrollmentId: uuid("enrollment_id")
      .notNull()
      .references(() => studentSubjectEnrollments.id, { onDelete: "restrict" }),
    type: creditGrantTypeEnum("type").notNull(),
    creditsGranted: integer("credits_granted").notNull(),
    lessonTopupId: uuid("lesson_topup_id").references(() => lessonTopups.id, { onDelete: "restrict" }),
    sourceTransferId: uuid("source_transfer_id"),
    restrictedTeacherId: uuid("restricted_teacher_id").references(() => teacherProfiles.userId, {
      onDelete: "restrict",
    }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("lesson_credit_grants_enrollment_idx").on(table.enrollmentId, table.createdAt),
    uniqueIndex("lesson_credit_grants_purchase_topup_uidx").on(table.lessonTopupId),
  ],
);

export const lessonCreditDebits = pgTable(
  "lesson_credit_debits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    enrollmentId: uuid("enrollment_id")
      .notNull()
      .references(() => studentSubjectEnrollments.id, { onDelete: "restrict" }),
    type: creditDebitTypeEnum("type").notNull(),
    creditsDebited: integer("credits_debited").notNull(),
    sessionId: uuid("session_id").references(() => liveSessions.id, { onDelete: "restrict" }),
    transferId: uuid("transfer_id"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("lesson_credit_debits_enrollment_idx").on(table.enrollmentId, table.createdAt)],
);

export const lessonCreditAllocations = pgTable(
  "lesson_credit_allocations",
  {
    debitId: uuid("debit_id")
      .notNull()
      .references(() => lessonCreditDebits.id, { onDelete: "restrict" }),
    grantId: uuid("grant_id")
      .notNull()
      .references(() => lessonCreditGrants.id, { onDelete: "restrict" }),
    credits: integer("credits").notNull(),
  },
  (table) => [primaryKey({ columns: [table.debitId, table.grantId] }), index("lesson_credit_allocations_grant_idx").on(table.grantId)],
);

export const lessonCreditTransfers = pgTable(
  "lesson_credit_transfers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fromEnrollmentId: uuid("from_enrollment_id")
      .notNull()
      .references(() => studentSubjectEnrollments.id, { onDelete: "restrict" }),
    toEnrollmentId: uuid("to_enrollment_id")
      .notNull()
      .references(() => studentSubjectEnrollments.id, { onDelete: "restrict" }),
    credits: integer("credits").notNull(),
    requestedByParent: boolean("requested_by_parent").notNull().default(true),
    processedBy: uuid("processed_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("lesson_credit_transfers_from_idx").on(table.fromEnrollmentId, table.createdAt),
    index("lesson_credit_transfers_to_idx").on(table.toEnrollmentId, table.createdAt),
  ],
);

export const firstLessonOrders = pgTable(
  "first_lesson_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => liveSessions.id, { onDelete: "restrict" }),
    subjectPriceVersionId: uuid("subject_price_version_id")
      .notNull()
      .references(() => subjectPriceVersions.id, { onDelete: "restrict" }),
    basePriceMinor: bigint("base_price_minor", { mode: "number" }).notNull(),
    finalPriceMinor: bigint("final_price_minor", { mode: "number" }).notNull(),
    currency: char("currency", { length: 3 }).notNull().default("UAH"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("first_lesson_orders_order_uidx").on(table.orderId),
    uniqueIndex("first_lesson_orders_session_uidx").on(table.sessionId),
  ],
);

export const sessionCreditReservations = pgTable(
  "session_credit_reservations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => liveSessions.id, { onDelete: "restrict" }),
    enrollmentId: uuid("enrollment_id")
      .notNull()
      .references(() => studentSubjectEnrollments.id, { onDelete: "restrict" }),
    creditsReserved: integer("credits_reserved").notNull(),
    status: creditReservationStatusEnum("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("session_credit_reservations_session_uidx").on(table.sessionId),
    index("session_credit_reservations_enrollment_idx").on(table.enrollmentId, table.status),
  ],
);
