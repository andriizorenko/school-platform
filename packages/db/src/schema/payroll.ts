import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  date,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { liveSessions } from "./scheduling.js";
import { subjects } from "./subjects.js";
import { teacherProfiles } from "./teachers.js";

export const payrollAccrualTypeEnum = pgEnum("payroll_accrual_type", [
  "REGULAR_60",
  "REGULAR_30",
  "FIRST_LESSON",
  "PAID_STUDENT_NO_SHOW",
  "COMPENSATION",
  "ADJUSTMENT",
]);

export const payrollPeriodStatusEnum = pgEnum("payroll_period_status", ["OPEN", "CALCULATED", "PAYING", "PAID"]);
export const teacherPayoutStatusEnum = pgEnum("teacher_payout_status", ["PENDING", "READY", "PAID"]);

export const payrollAccruals = pgTable(
  "payroll_accruals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacherProfiles.userId, { onDelete: "restrict" }),
    subjectId: uuid("subject_id").references(() => subjects.id, { onDelete: "restrict" }),
    sessionId: uuid("session_id").references(() => liveSessions.id, { onDelete: "restrict" }),
    type: payrollAccrualTypeEnum("type").notNull(),
    earnedForDate: date("earned_for_date").notNull(),
    rate60SnapshotMinor: bigint("rate_60_snapshot_minor", { mode: "number" }),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: char("currency", { length: 3 }).notNull().default("UAH"),
    compensationSourceTeacherId: uuid("compensation_source_teacher_id").references(() => teacherProfiles.userId, {
      onDelete: "restrict",
    }),
    reason: text("reason"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("payroll_accruals_session_uidx").on(table.sessionId),
    index("payroll_accruals_teacher_date_idx").on(table.teacherId, table.earnedForDate, table.createdAt),
    index("payroll_accruals_unsettled_lookup_idx").on(table.earnedForDate, table.teacherId, table.createdAt),
  ],
);

export const payrollPeriods = pgTable(
  "payroll_periods",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    payoutWindowStart: date("payout_window_start").notNull(),
    payoutWindowEnd: date("payout_window_end").notNull(),
    status: payrollPeriodStatusEnum("status").notNull().default("OPEN"),
    calculatedAt: timestamp("calculated_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("payroll_periods_start_end_uidx").on(table.periodStart, table.periodEnd),
    index("payroll_periods_status_dates_idx").on(table.status, table.periodStart, table.periodEnd),
  ],
);

export const payrollAccrualSettlements = pgTable(
  "payroll_accrual_settlements",
  {
    accrualId: uuid("accrual_id")
      .primaryKey()
      .references(() => payrollAccruals.id, { onDelete: "restrict" }),
    payrollPeriodId: uuid("payroll_period_id")
      .notNull()
      .references(() => payrollPeriods.id, { onDelete: "restrict" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("payroll_settlements_period_idx").on(table.payrollPeriodId)],
);

export const teacherPayoutDetails = pgTable(
  "teacher_payout_details",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacherProfiles.userId, { onDelete: "restrict" }),
    destinationType: text("destination_type").notNull(),
    detailsEncrypted: text("details_encrypted").notNull(),
    maskedDisplay: text("masked_display").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("teacher_payout_one_active_detail_uidx").on(table.teacherId).where(sql`${table.isActive} = true`),
    index("teacher_payout_details_teacher_created_idx").on(table.teacherId, table.createdAt),
  ],
);

export const teacherPayouts = pgTable(
  "teacher_payouts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    payrollPeriodId: uuid("payroll_period_id")
      .notNull()
      .references(() => payrollPeriods.id, { onDelete: "restrict" }),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacherProfiles.userId, { onDelete: "restrict" }),
    amountSnapshotMinor: bigint("amount_snapshot_minor", { mode: "number" }).notNull(),
    currency: char("currency", { length: 3 }).notNull().default("UAH"),
    payoutDestinationSnapshotEncrypted: text("payout_destination_snapshot_encrypted"),
    payoutDestinationMasked: text("payout_destination_masked"),
    status: teacherPayoutStatusEnum("status").notNull().default("PENDING"),
    confirmedBy: uuid("confirmed_by").references(() => users.id, { onDelete: "restrict" }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("teacher_payouts_period_teacher_uidx").on(table.payrollPeriodId, table.teacherId),
    index("teacher_payouts_period_status_idx").on(table.payrollPeriodId, table.status),
    index("teacher_payouts_teacher_idx").on(table.teacherId, table.createdAt),
  ],
);

export const teacherPayoutItems = pgTable(
  "teacher_payout_items",
  {
    payoutId: uuid("payout_id")
      .notNull()
      .references(() => teacherPayouts.id, { onDelete: "restrict" }),
    accrualId: uuid("accrual_id")
      .notNull()
      .unique()
      .references(() => payrollAccruals.id, { onDelete: "restrict" }),
  },
  (table) => [
    primaryKey({ columns: [table.payoutId, table.accrualId] }),
    index("teacher_payout_items_payout_idx").on(table.payoutId, table.accrualId),
  ],
);
