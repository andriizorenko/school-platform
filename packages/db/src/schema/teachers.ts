import {
  bigint,
  boolean,
  char,
  date,
  index,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  text,
} from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { subjects } from "./subjects.js";

export const teacherStatusEnum = pgEnum("teacher_status", [
  "INVITED",
  "ACTIVE",
  "ON_LEAVE",
  "ARCHIVED",
]);

export const teacherProfiles = pgTable(
  "teacher_profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "restrict" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    phone: text("phone").notNull(),
    zoomUrl: text("zoom_url"),
    status: teacherStatusEnum("status").notNull().default("INVITED"),
    startedAt: date("started_at"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("teacher_profiles_status_idx").on(table.status)],
);

export const teacherSubjects = pgTable(
  "teacher_subjects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacherProfiles.userId, { onDelete: "restrict" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "restrict" }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("teacher_subjects_teacher_subject_uidx").on(table.teacherId, table.subjectId),
    index("teacher_subjects_subject_idx").on(table.subjectId, table.isActive),
  ],
);

export const teacherRateVersions = pgTable(
  "teacher_rate_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    teacherSubjectId: uuid("teacher_subject_id")
      .notNull()
      .references(() => teacherSubjects.id, { onDelete: "restrict" }),
    rate60Minor: bigint("rate_60_minor", { mode: "number" }).notNull(),
    currency: char("currency", { length: 3 }).notNull().default("UAH"),
    effectiveFrom: date("effective_from").notNull(),
    effectiveUntil: date("effective_until"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("teacher_rate_versions_lookup_idx").on(table.teacherSubjectId, table.effectiveFrom)],
);
