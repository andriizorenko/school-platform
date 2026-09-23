import { sql } from "drizzle-orm";
import {
  date,
  index,
  pgEnum,
  pgTable,
  smallint,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { students } from "./students.js";
import { subjects } from "./subjects.js";
import { teacherProfiles } from "./teachers.js";

export const enrollmentStatusEnum = pgEnum("enrollment_status", ["ACTIVE", "PAUSED", "INACTIVE"]);

export const studentSubjectEnrollments = pgTable(
  "student_subject_enrollments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "restrict" }),
    status: enrollmentStatusEnum("status").notNull().default("ACTIVE"),
    defaultDurationMinutes: smallint("default_duration_minutes").notNull().default(60),
    startedAt: date("started_at").notNull().default(sql`CURRENT_DATE`),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    inactiveAt: timestamp("inactive_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("student_subject_enrollment_uidx").on(table.studentId, table.subjectId),
    index("enrollments_student_idx").on(table.studentId, table.status),
    index("enrollments_subject_idx").on(table.subjectId, table.status),
  ],
);

export const teacherAssignments = pgTable(
  "teacher_assignments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    enrollmentId: uuid("enrollment_id")
      .notNull()
      .references(() => studentSubjectEnrollments.id, { onDelete: "restrict" }),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacherProfiles.userId, { onDelete: "restrict" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    assignedBy: uuid("assigned_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("one_active_teacher_per_enrollment")
      .on(table.enrollmentId)
      .where(sql`${table.endedAt} IS NULL`),
    index("teacher_assignments_teacher_idx").on(table.teacherId, table.startedAt),
  ],
);
