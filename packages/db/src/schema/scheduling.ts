import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { studentSubjectEnrollments } from "./enrollments.js";
import { students } from "./students.js";
import { subjects } from "./subjects.js";
import { teacherProfiles } from "./teachers.js";

export const availabilitySeasonEnum = pgEnum("availability_season", ["SCHOOL_YEAR", "SUMMER"]);
export const vacationRequestStatusEnum = pgEnum("vacation_request_status", [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
]);

export const teacherAvailabilityTemplates = pgTable(
  "teacher_availability_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacherProfiles.userId, { onDelete: "restrict" }),
    season: availabilitySeasonEnum("season").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("teacher_availability_template_uidx").on(table.teacherId, table.season)],
);

export const teacherAvailabilityWindows = pgTable(
  "teacher_availability_windows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => teacherAvailabilityTemplates.id, { onDelete: "cascade" }),
    dayOfWeek: smallint("day_of_week").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("teacher_availability_windows_template_idx").on(table.templateId, table.dayOfWeek, table.startTime)],
);

export const teacherAvailabilityExceptions = pgTable(
  "teacher_availability_exceptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacherProfiles.userId, { onDelete: "restrict" }),
    exceptionDate: date("exception_date").notNull(),
    isUnavailableAllDay: boolean("is_unavailable_all_day").notNull().default(false),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("teacher_availability_exception_uidx").on(table.teacherId, table.exceptionDate)],
);

export const teacherAvailabilityExceptionWindows = pgTable(
  "teacher_availability_exception_windows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    exceptionId: uuid("exception_id")
      .notNull()
      .references(() => teacherAvailabilityExceptions.id, { onDelete: "cascade" }),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("teacher_availability_exception_windows_idx").on(table.exceptionId, table.startTime)],
);

export const teacherVacationRequests = pgTable(
  "teacher_vacation_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacherProfiles.userId, { onDelete: "restrict" }),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    comment: text("comment"),
    status: vacationRequestStatusEnum("status").notNull().default("PENDING"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "restrict" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("teacher_vacation_requests_teacher_idx").on(table.teacherId, table.startsOn, table.endsOn, table.status)],
);

export const regularScheduleVersions = pgTable(
  "regular_schedule_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    enrollmentId: uuid("enrollment_id")
      .notNull()
      .references(() => studentSubjectEnrollments.id, { onDelete: "restrict" }),
    effectiveFrom: date("effective_from").notNull(),
    effectiveUntil: date("effective_until"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("regular_schedule_versions_lookup_idx").on(table.enrollmentId, table.effectiveFrom)],
);

export const regularScheduleSlots = pgTable(
  "regular_schedule_slots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scheduleVersionId: uuid("schedule_version_id")
      .notNull()
      .references(() => regularScheduleVersions.id, { onDelete: "cascade" }),
    dayOfWeek: smallint("day_of_week").notNull(),
    startTime: time("start_time").notNull(),
    durationMinutes: smallint("duration_minutes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("regular_schedule_slot_uidx").on(table.scheduleVersionId, table.dayOfWeek, table.startTime),
    index("regular_schedule_slots_version_idx").on(table.scheduleVersionId, table.dayOfWeek, table.startTime),
  ],
);

export const sessionTypeEnum = pgEnum("session_type", ["FIRST", "REGULAR"]);
export const sessionFundingStatusEnum = pgEnum("session_funding_status", ["BOOKED", "PAID"]);
export const liveSessionStatusEnum = pgEnum("live_session_status", [
  "SCHEDULED",
  "COMPLETED",
  "CHARGED_NO_SHOW",
  "CANCELLED",
  "EXPIRED_UNPAID",
]);

export const liveSessions = pgTable(
  "live_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    enrollmentId: uuid("enrollment_id").references(() => studentSubjectEnrollments.id, { onDelete: "restrict" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "restrict" }),
    primaryTeacherId: uuid("primary_teacher_id")
      .notNull()
      .references(() => teacherProfiles.userId, { onDelete: "restrict" }),
    actualTeacherId: uuid("actual_teacher_id")
      .notNull()
      .references(() => teacherProfiles.userId, { onDelete: "restrict" }),
    scheduleSlotId: uuid("schedule_slot_id").references(() => regularScheduleSlots.id, { onDelete: "restrict" }),
    occurrenceDate: date("occurrence_date"),
    sessionType: sessionTypeEnum("session_type").notNull(),
    fundingStatus: sessionFundingStatusEnum("funding_status").notNull(),
    status: liveSessionStatusEnum("status").notNull().default("SCHEDULED"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    topicTitle: text("topic_title"),
    homeworkAssigned: boolean("homework_assigned"),
    markedAt: timestamp("marked_at", { withTimezone: true }),
    markedBy: uuid("marked_by").references(() => users.id, { onDelete: "restrict" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("live_session_schedule_occurrence_uidx")
      .on(table.scheduleSlotId, table.occurrenceDate)
      .where(sql`${table.scheduleSlotId} IS NOT NULL`),
    index("live_sessions_teacher_calendar_idx").on(table.actualTeacherId, table.startsAt),
    index("live_sessions_student_calendar_idx").on(table.studentId, table.startsAt),
    index("live_sessions_subject_calendar_idx").on(table.subjectId, table.startsAt),
  ],
);

export const rescheduleReasonEnum = pgEnum("reschedule_reason", [
  "PARENT_REQUEST",
  "STUDENT_CANNOT_ATTEND",
  "STUDENT_NO_SHOW",
  "STUDENT_ADVANCE_NOTICE",
  "STUDENT_LATE_NO_NOTICE",
  "STUDENT_TECHNICAL",
  "TEACHER_TECHNICAL",
  "TEACHER_PERSONAL",
  "TEACHER_VACATION",
  "TEACHER_ADVANCE_NOTICE",
  "TEACHER_LATE_CANCELLATION",
  "STUDENT_PAUSE",
  "SCHOOL_REASON",
  "OTHER",
]);

export const rescheduleModeEnum = pgEnum("reschedule_mode", ["FREE_SLOT", "END_OF_PAID_SEQUENCE", "MANUAL"]);

export const sessionReschedules = pgTable(
  "session_reschedules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => liveSessions.id, { onDelete: "restrict" }),
    fromStartAt: timestamp("from_start_at", { withTimezone: true }).notNull(),
    fromEndAt: timestamp("from_end_at", { withTimezone: true }).notNull(),
    toStartAt: timestamp("to_start_at", { withTimezone: true }).notNull(),
    toEndAt: timestamp("to_end_at", { withTimezone: true }).notNull(),
    reason: rescheduleReasonEnum("reason").notNull(),
    mode: rescheduleModeEnum("mode").notNull(),
    comment: text("comment"),
    initiatedBy: uuid("initiated_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("session_reschedules_session_idx").on(table.sessionId, table.createdAt)],
);

export const sessionIncidentTypeEnum = pgEnum("session_incident_type", [
  "STUDENT_NO_SHOW",
  "TEACHER_LATE_CANCELLATION",
]);
export const sessionIncidentOutcomeEnum = pgEnum("session_incident_outcome", [
  "RESCHEDULE_REQUIRED_NO_CHARGE",
  "CHARGED_NO_SHOW",
  "COMPENSATION_GRANTED",
]);

export const sessionIncidents = pgTable(
  "session_incidents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => liveSessions.id, { onDelete: "restrict" }),
    type: sessionIncidentTypeEnum("type").notNull(),
    responsibleUserId: uuid("responsible_user_id").references(() => users.id, { onDelete: "restrict" }),
    responsibleStudentId: uuid("responsible_student_id").references(() => students.id, { onDelete: "restrict" }),
    responsibleTeacherId: uuid("responsible_teacher_id").references(() => teacherProfiles.userId, { onDelete: "restrict" }),
    policyStrikeNumber: smallint("policy_strike_number").notNull(),
    outcome: sessionIncidentOutcomeEnum("outcome"),
    comment: text("comment"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("session_incidents_session_idx").on(table.sessionId, table.createdAt)],
);

export const studentAttendancePolicyStates = pgTable("student_attendance_policy_states", {
  enrollmentId: uuid("enrollment_id")
    .primaryKey()
    .references(() => studentSubjectEnrollments.id, { onDelete: "restrict" }),
  strikeCount: smallint("strike_count").notNull().default(0),
  cleanStreak: smallint("clean_streak").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const teacherStudentPolicyStates = pgTable(
  "teacher_student_policy_states",
  {
    enrollmentId: uuid("enrollment_id")
      .notNull()
      .references(() => studentSubjectEnrollments.id, { onDelete: "restrict" }),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teacherProfiles.userId, { onDelete: "restrict" }),
    strikeCount: smallint("strike_count").notNull().default(0),
    cleanStreak: smallint("clean_streak").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.enrollmentId, table.teacherId] })],
);

export const studentEnrollmentPauses = pgTable(
  "student_enrollment_pauses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    enrollmentId: uuid("enrollment_id")
      .notNull()
      .references(() => studentSubjectEnrollments.id, { onDelete: "restrict" }),
    startsOn: date("starts_on").notNull(),
    returnsOn: date("returns_on").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("student_enrollment_pauses_idx").on(table.enrollmentId, table.startsOn, table.returnsOn)],
);
