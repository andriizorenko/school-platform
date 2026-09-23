import { config as loadEnv } from "dotenv";
import { resolve as resolvePath } from "node:path";
import argon2 from "argon2";
import { and, eq } from "drizzle-orm";
import { createDatabase } from "./client.js";
import {
  permissions,
  rolePermissions,
  roles,
  staffProfiles,
  subjects,
  teacherAvailabilityTemplates,
  teacherAvailabilityWindows,
  teacherProfiles,
  teacherRateVersions,
  teacherSubjects,
  subjectPriceVersions,
  userRoles,
  users,
} from "./schema/index.js";

loadEnv({ path: resolvePath(process.cwd(), "../../.env") });
loadEnv();

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const roleSeeds = [
  ["ADMIN", "Administrator"],
  ["SUPPORT_MANAGER", "Support manager"],
  ["MANAGER", "Manager"],
  ["FINANCIER", "Financier"],
  ["TEACHER", "Teacher"],
  ["PARENT", "Parent"],
  ["STUDENT", "Student"],
] as const;

const permissionSeeds = [
  ["family.view", "View families"],
  ["family.manage", "Create and manage families"],
  ["student.view", "View students"],
  ["student.manage", "Manage students"],
  ["student.manager.assign", "Assign a primary manager to a student"],
  ["student.schedule.manage", "Manage a student's regular schedule"],
  ["staff.view", "View staff profiles"],
  ["subject.view", "View subjects"],
  ["subject.manage", "Manage subjects"],
  ["subject.price.view", "View subject prices"],
  ["subject.price.manage", "Manage subject prices"],
  ["enrollment.manage", "Create and manage student subject enrollments"],
  ["teacher.view", "View teachers"],
  ["teacher.manage", "Create teachers and manage teaching subjects"],
  ["teacher.assignment.manage", "Assign a primary teacher to an enrollment"],
  ["teacher.rate.view", "View teacher rates"],
  ["teacher.rate.manage", "Manage teacher rates"],
  ["teacher.availability.view", "View teacher availability"],
  ["teacher.availability.manage", "Manage teacher availability"],
  ["lesson.view", "View lessons"],
  ["lesson.first.manage", "Create and manage first lessons"],
  ["lesson.incident.record", "Record student and teacher lesson incidents"],
  ["lesson.mark", "Mark lessons"],
  ["lesson.reschedule", "Reschedule lessons"],
  ["lesson.balance.view", "View remaining lesson balance without financial details"],
  ["report.view", "View progress reports"],
  ["report.request", "Request a progress report"],
  ["report.complete", "Complete a requested progress report"],
  ["report.visibility.manage", "Change student visibility of a progress report"],
  ["billing.view", "View customer billing"],
  ["finance.analytics.view", "View school-wide financial analytics"],
  ["billing.record_payment", "Record customer payments"],
  ["billing.adjust_balance", "Adjust lesson balance"],
  ["billing.checkout", "Create customer checkout intents"],
  ["billing.refund", "Refund successful online payments and revoke refundable lesson credits"],
  ["billing.reconcile", "Review and resolve payment-provider reconciliation events"],
  ["payroll.view", "View own or permitted payroll data"],
  ["payroll.operations.view", "View school-wide payroll operations"],
  ["payroll.confirm", "Confirm teacher payouts"],
  ["payroll.details.manage", "Manage teacher payout details"],
  ["user.suspend", "Suspend or restore user accounts"],
  ["user.invite", "Send account invitations"],
  ["roles.manage", "Manage roles and permissions"],
  ["settings.manage", "Manage school settings"],
  ["integrations.manage", "Manage critical integrations"],
  ["ops.dashboard.view", "View operational dashboards"],
  ["lead.view", "View leads"],
  ["lead.manage", "Manage leads"],
  ["course.view", "View courses"],
  ["course.manage", "Manage course content and access plans"],
  ["course.purchase", "Purchase or grant course access"],
  ["course.progress", "Use course content and progress"],
  ["audit.view", "View audit log"],
] as const;

const rolePermissionMap: Record<string, string[]> = {
  ADMIN: permissionSeeds.map(([code]) => code),
  SUPPORT_MANAGER: [
    "family.view",
    "family.manage",
    "student.view",
    "student.manage",
    "student.manager.assign",
    "student.schedule.manage",
    "staff.view",
    "subject.view",
    "subject.price.view",
    "enrollment.manage",
    "teacher.view",
    "teacher.manage",
    "teacher.assignment.manage",
    "teacher.availability.view",
    "teacher.availability.manage",
    "lesson.view",
    "lesson.first.manage",
    "lesson.incident.record",
    "lesson.balance.view",
    "lesson.mark",
    "lesson.reschedule",
    "report.view",
    "report.complete",
    "billing.view",
    "billing.record_payment",
    "billing.adjust_balance",
    "billing.checkout",
    "billing.refund",
    "billing.reconcile",
    "user.suspend",
    "user.invite",
    "ops.dashboard.view",
    "lead.view",
    "lead.manage",
    "course.view",
    "course.manage",
    "course.purchase",
    "course.progress",
    "audit.view",
  ],
  MANAGER: [
    "family.view",
    "family.manage",
    "student.view",
    "student.manage",
    "student.manager.assign",
    "student.schedule.manage",
    "staff.view",
    "subject.view",
    "subject.price.view",
    "enrollment.manage",
    "teacher.view",
    "teacher.assignment.manage",
    "teacher.availability.view",
    "teacher.availability.manage",
    "lesson.view",
    "lesson.first.manage",
    "lesson.incident.record",
    "lesson.balance.view",
    "lesson.mark",
    "lesson.reschedule",
    "report.view",
    "report.complete",
    "billing.view",
    "billing.record_payment",
    "billing.adjust_balance",
    "billing.checkout",
    "billing.refund",
    "billing.reconcile",
    "user.invite",
    "ops.dashboard.view",
    "lead.view",
    "lead.manage",
    "course.view",
    "course.purchase",
  ],
  FINANCIER: ["staff.view", "subject.view", "teacher.view", "teacher.rate.view", "billing.view", "billing.refund", "billing.reconcile", "payroll.view", "payroll.operations.view", "payroll.confirm", "payroll.details.manage"],
  TEACHER: [
    "subject.view",
    "student.view",
    "teacher.availability.view",
    "teacher.availability.manage",
    "lesson.view",
    "lesson.incident.record",
    "lesson.balance.view",
    "lesson.mark",
    "lesson.reschedule",
    "report.view",
    "report.complete",
    "payroll.view",
    "payroll.details.manage",
    "course.view",
  ],
  PARENT: ["subject.view", "subject.price.view", "student.view", "lesson.view", "lesson.balance.view", "lesson.reschedule", "billing.view", "billing.checkout", "report.view", "report.request", "report.visibility.manage", "course.view", "course.purchase", "course.progress"],
  STUDENT: ["subject.view", "student.view", "lesson.view", "lesson.balance.view", "report.view", "course.view", "course.progress"],
};

async function ensureUser(
  db: ReturnType<typeof createDatabase>["db"],
  input: {
    email: string;
    password: string;
    roleCode: string;
    staff?: { firstName: string; lastName: string; phone?: string };
  },
) {
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
        updatedAt: new Date(),
      },
    })
    .returning({ id: users.id });

  const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.code, input.roleCode)).limit(1);
  if (!role) throw new Error(`${input.roleCode} role seed failed`);

  await db
    .insert(userRoles)
    .values({ userId: user.id, roleId: role.id, assignedBy: user.id })
    .onConflictDoNothing();

  if (input.staff) {
    await db
      .insert(staffProfiles)
      .values({
        userId: user.id,
        firstName: input.staff.firstName,
        lastName: input.staff.lastName,
        phone: input.staff.phone,
      })
      .onConflictDoUpdate({
        target: staffProfiles.userId,
        set: {
          firstName: input.staff.firstName,
          lastName: input.staff.lastName,
          phone: input.staff.phone,
          archivedAt: null,
          updatedAt: new Date(),
        },
      });
  }

  return user.id;
}

async function runSeed() {
  const { db, pool } = createDatabase(databaseUrl);

  try {
    for (const [code, name] of roleSeeds) {
      await db.insert(roles).values({ code, name }).onConflictDoNothing({ target: roles.code });
    }

    for (const [code, description] of permissionSeeds) {
      await db
        .insert(permissions)
        .values({ code, description })
        .onConflictDoNothing({ target: permissions.code });
    }

    const seededRoles = await db.select().from(roles);
    const seededPermissions = await db.select().from(permissions);
    const permissionByCode = new Map(seededPermissions.map((permission) => [permission.code, permission.id]));

    for (const role of seededRoles) {
      const permissionCodes = rolePermissionMap[role.code] ?? [];
      for (const permissionCode of permissionCodes) {
        const permissionId = permissionByCode.get(permissionCode);
        if (!permissionId) throw new Error(`Permission ${permissionCode} is not seeded`);

        await db
          .insert(rolePermissions)
          .values({ roleId: role.id, permissionId })
          .onConflictDoNothing();
      }
    }

    const adminEmail = process.env.SEED_ADMIN_EMAIL;
    const adminPassword = process.env.SEED_ADMIN_PASSWORD;
    let adminUserId: string | undefined;
    if (adminEmail && adminPassword) {
      adminUserId = await ensureUser(db, {
        email: adminEmail,
        password: adminPassword,
        roleCode: "ADMIN",
        staff: { firstName: "Dev", lastName: "Admin" },
      });
    }

    const managerEmail = process.env.SEED_MANAGER_EMAIL;
    const managerPassword = process.env.SEED_MANAGER_PASSWORD;
    if (managerEmail && managerPassword) {
      await ensureUser(db, {
        email: managerEmail,
        password: managerPassword,
        roleCode: "MANAGER",
        staff: { firstName: "Dev", lastName: "Manager" },
      });
    }

    if (process.env.SEED_DEVELOPMENT_DATA === "true") {
      const [mathSubject] = await db
        .insert(subjects)
        .values({ name: "Математика", slug: "mathematics", status: "ACTIVE" })
        .onConflictDoUpdate({
          target: subjects.slug,
          set: { name: "Математика", status: "ACTIVE", archivedAt: null },
        })
        .returning({ id: subjects.id });

      if (adminUserId) {
        const priceEffectiveFrom = "2026-09-01";
        const [existingPrice] = await db
          .select({ id: subjectPriceVersions.id })
          .from(subjectPriceVersions)
          .where(
            and(
              eq(subjectPriceVersions.subjectId, mathSubject.id),
              eq(subjectPriceVersions.effectiveFrom, priceEffectiveFrom),
            ),
          )
          .limit(1);

        if (!existingPrice) {
          await db.insert(subjectPriceVersions).values({
            subjectId: mathSubject.id,
            regular60PriceMinor: Number(process.env.SEED_MATH_PRICE_60_MINOR ?? "40000"),
            firstLessonPriceMinor: Number(process.env.SEED_MATH_FIRST_LESSON_PRICE_MINOR ?? "15000"),
            currency: "UAH",
            effectiveFrom: priceEffectiveFrom,
            createdBy: adminUserId,
          });
        }
      }

      const teacherEmail = process.env.SEED_TEACHER_EMAIL;
      const teacherPassword = process.env.SEED_TEACHER_PASSWORD;
      if (teacherEmail && teacherPassword) {
        const teacherUserId = await ensureUser(db, {
          email: teacherEmail,
          password: teacherPassword,
          roleCode: "TEACHER",
        });

        await db
          .insert(teacherProfiles)
          .values({
            userId: teacherUserId,
            firstName: "Анна",
            lastName: "Петренко",
            phone: "+380000000000",
            zoomUrl: "https://zoom.us/j/example",
            status: "ACTIVE",
            startedAt: new Date().toISOString().slice(0, 10),
          })
          .onConflictDoUpdate({
            target: teacherProfiles.userId,
            set: {
              firstName: "Анна",
              lastName: "Петренко",
              phone: "+380000000000",
              zoomUrl: "https://zoom.us/j/example",
              status: "ACTIVE",
              archivedAt: null,
              updatedAt: new Date(),
            },
          });

        const [teacherSubject] = await db
          .insert(teacherSubjects)
          .values({ teacherId: teacherUserId, subjectId: mathSubject.id, isActive: true })
          .onConflictDoUpdate({
            target: [teacherSubjects.teacherId, teacherSubjects.subjectId],
            set: { isActive: true },
          })
          .returning({ id: teacherSubjects.id });

        for (const season of ["SCHOOL_YEAR", "SUMMER"] as const) {
          const [template] = await db
            .insert(teacherAvailabilityTemplates)
            .values({ teacherId: teacherUserId, season, isActive: true })
            .onConflictDoUpdate({
              target: [teacherAvailabilityTemplates.teacherId, teacherAvailabilityTemplates.season],
              set: { isActive: true, updatedAt: new Date() },
            })
            .returning({ id: teacherAvailabilityTemplates.id });

          const existingWindows = await db
            .select({ id: teacherAvailabilityWindows.id })
            .from(teacherAvailabilityWindows)
            .where(eq(teacherAvailabilityWindows.templateId, template.id))
            .limit(1);

          if (!existingWindows.length) {
            await db.insert(teacherAvailabilityWindows).values([
              { templateId: template.id, dayOfWeek: 2, startTime: "10:00", endTime: "20:00" },
              { templateId: template.id, dayOfWeek: 4, startTime: "10:00", endTime: "20:00" },
            ]);
          }
        }

        if (adminUserId) {
          const effectiveFrom = "2026-09-01";
          const [existingRate] = await db
            .select({ id: teacherRateVersions.id })
            .from(teacherRateVersions)
            .where(
              and(
                eq(teacherRateVersions.teacherSubjectId, teacherSubject.id),
                eq(teacherRateVersions.effectiveFrom, effectiveFrom),
              ),
            )
            .limit(1);

          if (!existingRate) {
            await db.insert(teacherRateVersions).values({
              teacherSubjectId: teacherSubject.id,
              rate60Minor: Number(process.env.SEED_TEACHER_RATE_60_MINOR ?? "20000"),
              currency: "UAH",
              effectiveFrom,
              createdBy: adminUserId,
            });
          }
        }
      }
    }

    console.log("Seed completed.");
  } finally {
    await pool.end();
  }
}

runSeed().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
