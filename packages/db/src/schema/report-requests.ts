import { sql } from "drizzle-orm";
import { boolean, index, pgEnum, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { parentProfiles } from "./families.js";
import { studentSubjectEnrollments } from "./enrollments.js";
import { progressReports } from "./reports.js";
import { liveSessions } from "./scheduling.js";
import { students } from "./students.js";
import { subjects } from "./subjects.js";

export const progressReportRequestStatusEnum = pgEnum("progress_report_request_status", ["PENDING", "COMPLETED", "CANCELLED"]);

export const progressReportRequests = pgTable(
  "progress_report_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    studentId: uuid("student_id").notNull().references(() => students.id, { onDelete: "restrict" }),
    subjectId: uuid("subject_id").notNull().references(() => subjects.id, { onDelete: "restrict" }),
    enrollmentId: uuid("enrollment_id").notNull().references(() => studentSubjectEnrollments.id, { onDelete: "restrict" }),
    requestedByParentId: uuid("requested_by_parent_id").notNull().references(() => parentProfiles.userId, { onDelete: "restrict" }),
    targetSessionId: uuid("target_session_id").references(() => liveSessions.id, { onDelete: "restrict" }),
    visibleToStudent: boolean("visible_to_student").notNull().default(true),
    status: progressReportRequestStatusEnum("status").notNull().default("PENDING"),
    reportId: uuid("report_id").unique().references(() => progressReports.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("progress_report_requests_one_pending_uidx")
      .on(table.studentId, table.subjectId)
      .where(sql`${table.status} = 'PENDING'`),
    index("progress_report_requests_target_idx").on(table.targetSessionId),
    index("progress_report_requests_enrollment_created_idx").on(table.enrollmentId, table.createdAt),
  ],
);
