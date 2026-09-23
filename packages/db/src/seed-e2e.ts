import { config as loadEnv } from "dotenv";
import { resolve as resolvePath } from "node:path";
import argon2 from "argon2";
import { and, eq, isNull } from "drizzle-orm";
import { createDatabase } from "./client.js";
import {
  families,
  mfaMethods,
  mfaRecoveryCodes,
  parentProfiles,
  roles,
  staffProfiles,
  studentManagerAssignments,
  students,
  studentSubjectEnrollments,
  subjects,
  subjectPriceVersions,
  teacherAssignments,
  teacherProfiles,
  teacherSubjects,
  userRoles,
  userSessions,
  users,
} from "./schema/index.js";

loadEnv({ path: resolvePath(process.cwd(), "../../.env") });
loadEnv();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const appEnv = String(process.env.APP_ENV ?? "").trim().toLowerCase();
const productionMode = process.env.NODE_ENV === "production";
if (appEnv === "production") throw new Error("E2E fixture seed refuses to run with APP_ENV=production");
if (productionMode && !["staging", "rc"].includes(appEnv)) {
  throw new Error("E2E fixture seed in NODE_ENV=production is allowed only for explicit staging/rc environments");
}
if (process.env.E2E_ALLOW_SEED !== "true") throw new Error("Set E2E_ALLOW_SEED=true to acknowledge destructive test-fixture resets");
if (productionMode && process.env.E2E_ALLOW_STAGING_SEED !== "true") {
  throw new Error("Set E2E_ALLOW_STAGING_SEED=true to acknowledge fixture resets against the dedicated staging/rc database");
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the E2E fixture seed`);
  return value;
}

const identities = {
  admin: { email: requiredEnv("E2E_ADMIN_EMAIL"), password: requiredEnv("E2E_ADMIN_PASSWORD"), role: "ADMIN" },
  manager: { email: requiredEnv("E2E_MANAGER_EMAIL"), password: requiredEnv("E2E_MANAGER_PASSWORD"), role: "MANAGER" },
  teacher: { email: requiredEnv("E2E_TEACHER_EMAIL"), password: requiredEnv("E2E_TEACHER_PASSWORD"), role: "TEACHER" },
  parent: { email: requiredEnv("E2E_PARENT_EMAIL"), password: requiredEnv("E2E_PARENT_PASSWORD"), role: "PARENT" },
  student: { email: requiredEnv("E2E_STUDENT_EMAIL"), password: requiredEnv("E2E_STUDENT_PASSWORD"), role: "STUDENT" },
} as const;

type Db = ReturnType<typeof createDatabase>["db"];

async function ensureRoleUser(db: Db, input: { email: string; password: string; role: string }) {
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
  const [user] = await db
    .insert(users)
    .values({
      email: input.email.toLowerCase(),
      passwordHash,
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        passwordHash,
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
        suspendedAt: null,
        suspendedBy: null,
        suspensionReason: null,
        archivedAt: null,
        updatedAt: new Date(),
      },
    })
    .returning({ id: users.id });

  const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.code, input.role)).limit(1);
  if (!role) throw new Error(`Role ${input.role} must be seeded before E2E fixtures`);

  await db.insert(userRoles).values({ userId: user.id, roleId: role.id, assignedBy: user.id }).onConflictDoNothing();
  return user.id;
}

async function runSeed() {
  const { db, pool } = createDatabase(databaseUrl);

  try {
    const adminId = await ensureRoleUser(db, identities.admin);
    const managerId = await ensureRoleUser(db, identities.manager);
    const teacherId = await ensureRoleUser(db, identities.teacher);
    const parentId = await ensureRoleUser(db, identities.parent);
    const studentUserId = await ensureRoleUser(db, identities.student);

    await db
      .insert(staffProfiles)
      .values({ userId: adminId, firstName: "E2E", lastName: "Admin", phone: "+380000000101" })
      .onConflictDoUpdate({
        target: staffProfiles.userId,
        set: { firstName: "E2E", lastName: "Admin", phone: "+380000000101", archivedAt: null, updatedAt: new Date() },
      });

    await db
      .insert(staffProfiles)
      .values({ userId: managerId, firstName: "E2E", lastName: "Manager", phone: "+380000000102" })
      .onConflictDoUpdate({
        target: staffProfiles.userId,
        set: { firstName: "E2E", lastName: "Manager", phone: "+380000000102", archivedAt: null, updatedAt: new Date() },
      });

    await db
      .insert(teacherProfiles)
      .values({
        userId: teacherId,
        firstName: "E2E",
        lastName: "Teacher",
        phone: "+380000000103",
        zoomUrl: "https://zoom.us/j/e2e-school-platform",
        status: "ACTIVE",
        startedAt: "2026-09-01",
      })
      .onConflictDoUpdate({
        target: teacherProfiles.userId,
        set: {
          firstName: "E2E",
          lastName: "Teacher",
          phone: "+380000000103",
          zoomUrl: "https://zoom.us/j/e2e-school-platform",
          status: "ACTIVE",
          archivedAt: null,
          updatedAt: new Date(),
        },
      });

    let familyId: string;
    const [existingParent] = await db
      .select({ familyId: parentProfiles.familyId })
      .from(parentProfiles)
      .where(eq(parentProfiles.userId, parentId))
      .limit(1);

    if (existingParent) {
      familyId = existingParent.familyId;
    } else {
      const [family] = await db.insert(families).values({}).returning({ id: families.id });
      familyId = family.id;
    }

    await db
      .update(families)
      .set({ archivedAt: null, archivedBy: null, archiveReason: null })
      .where(eq(families.id, familyId));

    await db
      .insert(parentProfiles)
      .values({ userId: parentId, familyId, firstName: "E2E", lastName: "Parent", phone: "+380000000104" })
      .onConflictDoUpdate({
        target: parentProfiles.userId,
        set: { familyId, firstName: "E2E", lastName: "Parent", phone: "+380000000104", updatedAt: new Date() },
      });

    const [student] = await db
      .insert(students)
      .values({
        familyId,
        userId: studentUserId,
        firstName: "E2E",
        lastName: "Student",
        birthDate: "2013-05-15",
        gradeLevel: 7,
      })
      .onConflictDoUpdate({
        target: students.userId,
        set: {
          familyId,
          firstName: "E2E",
          lastName: "Student",
          birthDate: "2013-05-15",
          gradeLevel: 7,
          archivedAt: null,
          archivedBy: null,
          archiveReason: null,
          updatedAt: new Date(),
        },
      })
      .returning({ id: students.id });

    const [subject] = await db
      .insert(subjects)
      .values({ name: "E2E Mathematics", slug: "e2e-mathematics", status: "ACTIVE" })
      .onConflictDoUpdate({
        target: subjects.slug,
        set: { name: "E2E Mathematics", status: "ACTIVE", archivedAt: null },
      })
      .returning({ id: subjects.id });

    const [existingPrice] = await db
      .select({ id: subjectPriceVersions.id })
      .from(subjectPriceVersions)
      .where(eq(subjectPriceVersions.subjectId, subject.id))
      .limit(1);
    if (!existingPrice) {
      await db.insert(subjectPriceVersions).values({
        subjectId: subject.id,
        regular60PriceMinor: 40000,
        firstLessonPriceMinor: 15000,
        currency: "UAH",
        effectiveFrom: "2026-01-01",
        createdBy: adminId,
      });
    }

    await db
      .insert(teacherSubjects)
      .values({ teacherId, subjectId: subject.id, isActive: true })
      .onConflictDoUpdate({
        target: [teacherSubjects.teacherId, teacherSubjects.subjectId],
        set: { isActive: true },
      });

    const [enrollment] = await db
      .insert(studentSubjectEnrollments)
      .values({ studentId: student.id, subjectId: subject.id, status: "ACTIVE", defaultDurationMinutes: 60, startedAt: "2026-09-01" })
      .onConflictDoUpdate({
        target: [studentSubjectEnrollments.studentId, studentSubjectEnrollments.subjectId],
        set: { status: "ACTIVE", defaultDurationMinutes: 60, pausedAt: null, inactiveAt: null, updatedAt: new Date() },
      })
      .returning({ id: studentSubjectEnrollments.id });

    const [activeTeacherAssignment] = await db
      .select({ id: teacherAssignments.id, teacherId: teacherAssignments.teacherId })
      .from(teacherAssignments)
      .where(and(eq(teacherAssignments.enrollmentId, enrollment.id), isNull(teacherAssignments.endedAt)))
      .limit(1);

    if (activeTeacherAssignment && activeTeacherAssignment.teacherId !== teacherId) {
      await db.update(teacherAssignments).set({ endedAt: new Date() }).where(eq(teacherAssignments.id, activeTeacherAssignment.id));
    }
    if (!activeTeacherAssignment || activeTeacherAssignment.teacherId !== teacherId) {
      await db.insert(teacherAssignments).values({ enrollmentId: enrollment.id, teacherId, assignedBy: adminId });
    }

    const [activeManagerAssignment] = await db
      .select({ id: studentManagerAssignments.id, managerUserId: studentManagerAssignments.managerUserId })
      .from(studentManagerAssignments)
      .where(and(eq(studentManagerAssignments.studentId, student.id), isNull(studentManagerAssignments.endedAt)))
      .limit(1);

    if (activeManagerAssignment && activeManagerAssignment.managerUserId !== managerId) {
      await db.update(studentManagerAssignments).set({ endedAt: new Date() }).where(eq(studentManagerAssignments.id, activeManagerAssignment.id));
    }
    if (!activeManagerAssignment || activeManagerAssignment.managerUserId !== managerId) {
      await db.insert(studentManagerAssignments).values({ studentId: student.id, managerUserId: managerId, assignedBy: adminId });
    }

    const allIds = [adminId, managerId, teacherId, parentId, studentUserId];
    for (const userId of allIds) {
      await db.delete(userSessions).where(eq(userSessions.userId, userId));
    }

    // E2E must exercise the real first-time privileged MFA setup flow deterministically.
    await db.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, adminId));
    await db.delete(mfaMethods).where(eq(mfaMethods.userId, adminId));

    console.log("E2E fixture seed completed.");
  } finally {
    await pool.end();
  }
}

runSeed().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
