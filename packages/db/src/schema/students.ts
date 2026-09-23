import { index, pgTable, smallint, text, timestamp, uniqueIndex, uuid, date } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { families } from "./families.js";

export const students = pgTable(
  "students",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "restrict" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    birthDate: date("birth_date"),
    gradeLevel: smallint("grade_level"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedBy: uuid("archived_by").references(() => users.id, { onDelete: "restrict" }),
    archiveReason: text("archive_reason"),
  },
  (table) => [
    index("students_family_idx").on(table.familyId),
    uniqueIndex("students_user_uidx").on(table.userId),
  ],
);
