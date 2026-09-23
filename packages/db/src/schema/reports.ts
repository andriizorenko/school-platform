import { sql } from "drizzle-orm";
import { boolean, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { liveSessions } from "./scheduling.js";
import { students } from "./students.js";
import { subjects } from "./subjects.js";
import { teacherProfiles } from "./teachers.js";

export const progressReportTypeEnum = pgEnum("progress_report_type", ["INITIAL", "REQUESTED"]);

export const progressReports = pgTable(
  "progress_reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "restrict" }),
    sessionId: uuid("session_id").references(() => liveSessions.id, { onDelete: "restrict" }),
    reportType: progressReportTypeEnum("report_type").notNull(),
    strengths: text("strengths").notNull(),
    gaps: text("gaps").notNull(),
    actionPlan: text("action_plan").notNull(),
    visibleToParent: boolean("visible_to_parent").notNull().default(true),
    visibleToStudent: boolean("visible_to_student").notNull().default(true),
    createdByTeacherId: uuid("created_by_teacher_id")
      .notNull()
      .references(() => teacherProfiles.userId, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("progress_reports_initial_session_uidx")
      .on(table.sessionId)
      .where(sql`${table.reportType} = 'INITIAL' AND ${table.sessionId} IS NOT NULL`),
    index("progress_reports_student_subject_idx").on(table.studentId, table.subjectId, table.createdAt),
  ],
);
