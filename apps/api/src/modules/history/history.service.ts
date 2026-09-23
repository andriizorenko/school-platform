import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Database } from "@school/db";
import { sql } from "drizzle-orm";
import { DATABASE } from "../../common/database/database.constants";
import type { AuthUser } from "../auth/types";

const OPERATIONAL_ROLES = new Set(["ADMIN", "MANAGER", "SUPPORT_MANAGER"]);

@Injectable()
export class HistoryService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  private assertOperational(actor: AuthUser) {
    if (!actor.roles.some((role) => OPERATIONAL_ROLES.has(role))) {
      throw new ForbiddenException({
        code: "OPERATIONS_HISTORY_DENIED",
        message: "Operational history is available only to school operations staff",
      });
    }
  }

  async studentHistory(studentId: string, actor: AuthUser) {
    this.assertOperational(actor);

    const studentResult = await this.db.execute(sql`
      SELECT st.id,
             st.family_id AS "familyId",
             st.first_name AS "firstName",
             st.last_name AS "lastName",
             st.grade_level AS "gradeLevel",
             st.created_at AS "createdAt",
             st.archived_at AS "archivedAt"
      FROM students st
      WHERE st.id = ${studentId}
      LIMIT 1
    `);
    if (!studentResult.rowCount) {
      throw new NotFoundException({ code: "STUDENT_NOT_FOUND", message: "Student not found" });
    }
    const student = studentResult.rows[0] as any;

    const [managerHistoryResult, enrollmentResult] = await Promise.all([
      this.db.execute(sql`
        SELECT sma.id,
               sma.manager_user_id AS "managerUserId",
               sp.first_name AS "firstName",
               sp.last_name AS "lastName",
               sma.started_at AS "startedAt",
               sma.ended_at AS "endedAt",
               sma.created_at AS "createdAt"
        FROM student_manager_assignments sma
        JOIN staff_profiles sp ON sp.user_id = sma.manager_user_id
        WHERE sma.student_id = ${studentId}
        ORDER BY sma.started_at DESC
      `),
      this.db.execute(sql`
        SELECT e.id,
               e.status,
               e.default_duration_minutes AS "defaultDurationMinutes",
               e.started_at AS "startedAt",
               e.paused_at AS "pausedAt",
               e.inactive_at AS "inactiveAt",
               sub.id AS "subjectId",
               sub.name AS "subjectName"
        FROM student_subject_enrollments e
        JOIN subjects sub ON sub.id = e.subject_id
        WHERE e.student_id = ${studentId}
        ORDER BY e.created_at ASC
      `),
    ]);

    const enrollmentHistory = await Promise.all(
      enrollmentResult.rows.map(async (row: any) => {
        const enrollmentId = row.id as string;
        const [teachers, schedules, purchases, ledger, transfers] = await Promise.all([
          this.db.execute(sql`
            SELECT ta.id,
                   ta.teacher_id AS "teacherId",
                   tp.first_name AS "firstName",
                   tp.last_name AS "lastName",
                   ta.started_at AS "startedAt",
                   ta.ended_at AS "endedAt",
                   ta.created_at AS "createdAt"
            FROM teacher_assignments ta
            JOIN teacher_profiles tp ON tp.user_id = ta.teacher_id
            WHERE ta.enrollment_id = ${enrollmentId}
            ORDER BY ta.started_at DESC
          `),
          this.db.execute(sql`
            SELECT rsv.id,
                   rsv.effective_from AS "effectiveFrom",
                   rsv.effective_until AS "effectiveUntil",
                   rsv.created_at AS "createdAt",
                   COALESCE(
                     jsonb_agg(
                       jsonb_build_object(
                         'dayOfWeek', rss.day_of_week,
                         'startTime', rss.start_time,
                         'durationMinutes', rss.duration_minutes
                       ) ORDER BY rss.day_of_week, rss.start_time
                     ) FILTER (WHERE rss.id IS NOT NULL),
                     '[]'::jsonb
                   ) AS slots
            FROM regular_schedule_versions rsv
            LEFT JOIN regular_schedule_slots rss ON rss.schedule_version_id = rsv.id
            WHERE rsv.enrollment_id = ${enrollmentId}
            GROUP BY rsv.id
            ORDER BY rsv.effective_from DESC, rsv.created_at DESC
          `),
          this.db.execute(sql`
            SELECT lt.id,
                   lt.lesson_units AS "lessonUnits",
                   lt.credits_granted AS "creditsGranted",
                   lt.base_unit_price_minor AS "baseUnitPriceMinor",
                   lt.final_total_minor AS "finalTotalMinor",
                   lt.created_at AS "createdAt",
                   o.id AS "orderId",
                   o.source,
                   o.status,
                   o.currency,
                   o.subtotal_minor AS "subtotalMinor",
                   o.discount_minor AS "discountMinor",
                   o.total_minor AS "totalMinor",
                   o.paid_at AS "paidAt",
                   p.method AS "paymentMethod"
            FROM lesson_topups lt
            JOIN orders o ON o.id = lt.order_id
            LEFT JOIN LATERAL (
              SELECT p.method
              FROM payments p
              WHERE p.order_id = o.id
              ORDER BY p.created_at DESC
              LIMIT 1
            ) p ON true
            WHERE lt.enrollment_id = ${enrollmentId}
            ORDER BY lt.created_at DESC
          `),
          this.db.execute(sql`
            SELECT * FROM (
              SELECT g.id,
                     'GRANT'::text AS direction,
                     g.type::text AS type,
                     g.credits_granted AS credits,
                     g.restricted_teacher_id AS "restrictedTeacherId",
                     tp.first_name AS "restrictedTeacherFirstName",
                     tp.last_name AS "restrictedTeacherLastName",
                     g.lesson_topup_id AS "lessonTopupId",
                     g.source_transfer_id AS "transferId",
                     g.created_at AS "createdAt"
              FROM lesson_credit_grants g
              LEFT JOIN teacher_profiles tp ON tp.user_id = g.restricted_teacher_id
              WHERE g.enrollment_id = ${enrollmentId}

              UNION ALL

              SELECT d.id,
                     'DEBIT'::text AS direction,
                     d.type::text AS type,
                     d.credits_debited AS credits,
                     NULL::uuid AS "restrictedTeacherId",
                     NULL::text AS "restrictedTeacherFirstName",
                     NULL::text AS "restrictedTeacherLastName",
                     NULL::uuid AS "lessonTopupId",
                     d.transfer_id AS "transferId",
                     d.created_at AS "createdAt"
              FROM lesson_credit_debits d
              WHERE d.enrollment_id = ${enrollmentId}
            ) ledger
            ORDER BY "createdAt" DESC
            LIMIT 300
          `),
          this.db.execute(sql`
            SELECT t.id,
                   t.credits,
                   t.reason,
                   t.requested_by_parent AS "requestedByParent",
                   t.created_at AS "createdAt",
                   t.from_enrollment_id AS "fromEnrollmentId",
                   t.to_enrollment_id AS "toEnrollmentId",
                   fs.id AS "fromStudentId",
                   fs.first_name AS "fromStudentFirstName",
                   fs.last_name AS "fromStudentLastName",
                   ts.id AS "toStudentId",
                   ts.first_name AS "toStudentFirstName",
                   ts.last_name AS "toStudentLastName",
                   sub.name AS "subjectName"
            FROM lesson_credit_transfers t
            JOIN student_subject_enrollments fe ON fe.id = t.from_enrollment_id
            JOIN student_subject_enrollments te ON te.id = t.to_enrollment_id
            JOIN students fs ON fs.id = fe.student_id
            JOIN students ts ON ts.id = te.student_id
            JOIN subjects sub ON sub.id = fe.subject_id
            WHERE t.from_enrollment_id = ${enrollmentId}
               OR t.to_enrollment_id = ${enrollmentId}
            ORDER BY t.created_at DESC
          `),
        ]);

        return {
          ...row,
          teacherAssignments: teachers.rows,
          scheduleVersions: schedules.rows,
          purchases: purchases.rows,
          ledger: ledger.rows,
          transfers: transfers.rows,
        };
      }),
    );

    const auditResult = await this.db.execute(sql`
      WITH student_enrollments AS (
        SELECT id FROM student_subject_enrollments WHERE student_id = ${studentId}
      ), related_entities AS (
        SELECT ${studentId}::uuid AS id
        UNION SELECT id FROM student_enrollments
        UNION SELECT ta.id FROM teacher_assignments ta JOIN student_enrollments e ON e.id = ta.enrollment_id
        UNION SELECT rsv.id FROM regular_schedule_versions rsv JOIN student_enrollments e ON e.id = rsv.enrollment_id
        UNION SELECT lt.id FROM lesson_topups lt JOIN student_enrollments e ON e.id = lt.enrollment_id
        UNION SELECT ls.id FROM live_sessions ls WHERE ls.student_id = ${studentId}
        UNION SELECT lct.id FROM lesson_credit_transfers lct
          WHERE lct.from_enrollment_id IN (SELECT id FROM student_enrollments)
             OR lct.to_enrollment_id IN (SELECT id FROM student_enrollments)
        UNION SELECT sma.id FROM student_manager_assignments sma WHERE sma.student_id = ${studentId}
      )
      SELECT a.id,
             a.action,
             a.entity_type AS "entityType",
             a.entity_id AS "entityId",
             a.actor_role_code AS "actorRole",
             a.before_data AS "beforeData",
             a.after_data AS "afterData",
             a.created_at AS "createdAt",
             u.email AS "actorEmail",
             COALESCE(
               NULLIF(concat_ws(' ', sp.first_name, sp.last_name), ''),
               NULLIF(concat_ws(' ', tp.first_name, tp.last_name), ''),
               NULLIF(concat_ws(' ', pp.first_name, pp.last_name), ''),
               u.email
             ) AS "actorName"
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.actor_user_id
      LEFT JOIN staff_profiles sp ON sp.user_id = a.actor_user_id
      LEFT JOIN teacher_profiles tp ON tp.user_id = a.actor_user_id
      LEFT JOIN parent_profiles pp ON pp.user_id = a.actor_user_id
      WHERE a.entity_id IN (SELECT id FROM related_entities)
         OR (a.after_data->>'studentId') = ${studentId}
         OR (a.before_data->>'studentId') = ${studentId}
      ORDER BY a.created_at DESC
      LIMIT 200
    `);

    return {
      student,
      managerAssignments: managerHistoryResult.rows,
      enrollments: enrollmentHistory,
      activity: auditResult.rows,
    };
  }

  async familyOverview(familyId: string, actor: AuthUser) {
    this.assertOperational(actor);

    const familyResult = await this.db.execute(sql`
      SELECT f.id,
             f.created_at AS "createdAt",
             f.archived_at AS "archivedAt",
             f.archived_by AS "archivedBy",
             f.archive_reason AS "archiveReason",
             pp.user_id AS "parentUserId",
             pp.first_name AS "parentFirstName",
             pp.last_name AS "parentLastName",
             pp.phone AS "parentPhone",
             u.email AS "parentEmail",
             u.status AS "parentAccountStatus",
             (u.password_hash IS NOT NULL) AS "parentPasswordConfigured",
             inv.created_at AS "parentLastInvitationAt",
             inv.expires_at AS "parentLastInvitationExpiresAt",
             inv.accepted_at AS "parentLastInvitationAcceptedAt"
      FROM families f
      LEFT JOIN parent_profiles pp ON pp.family_id = f.id
      LEFT JOIN users u ON u.id = pp.user_id
      LEFT JOIN LATERAL (
        SELECT created_at,expires_at,accepted_at FROM user_invitations i
        WHERE i.user_id=u.id ORDER BY i.created_at DESC LIMIT 1
      ) inv ON true
      WHERE f.id = ${familyId}
      LIMIT 1
    `);
    if (!familyResult.rowCount) {
      throw new NotFoundException({ code: "FAMILY_NOT_FOUND", message: "Family not found" });
    }

    const [childrenResult, purchaseResult, courseResult] = await Promise.all([
      this.db.execute(sql`
        WITH balances AS (
          SELECT e.id,
                 COALESCE((SELECT SUM(g.credits_granted) FROM lesson_credit_grants g WHERE g.enrollment_id=e.id),0)::int
                 - COALESCE((SELECT SUM(d.credits_debited) FROM lesson_credit_debits d WHERE d.enrollment_id=e.id),0)::int AS credits
          FROM student_subject_enrollments e
        )
        SELECT st.id,
               st.first_name AS "firstName",
               st.last_name AS "lastName",
               st.grade_level AS "gradeLevel",
               st.user_id AS "userId",
               st.archived_at AS "archivedAt",
               st.archive_reason AS "archiveReason",
               su.email AS "accountEmail",
               su.status AS "accountStatus",
               (su.password_hash IS NOT NULL) AS "passwordConfigured",
               sinv.created_at AS "lastInvitationAt",
               sinv.expires_at AS "lastInvitationExpiresAt",
               sinv.accepted_at AS "lastInvitationAcceptedAt",
               sma.manager_user_id AS "managerUserId",
               sm.first_name AS "managerFirstName",
               sm.last_name AS "managerLastName",
               COALESCE(
                 jsonb_agg(
                   jsonb_build_object(
                     'id', e.id,
                     'status', e.status,
                     'subjectId', sub.id,
                     'subjectName', sub.name,
                     'teacherId', ta.teacher_id,
                     'teacherFirstName', tp.first_name,
                     'teacherLastName', tp.last_name,
                     'balanceCredits', COALESCE(b.credits,0),
                     'balanceLessonUnits', COALESCE(b.credits,0)/2.0
                   ) ORDER BY sub.name
                 ) FILTER (WHERE e.id IS NOT NULL),
                 '[]'::jsonb
               ) AS enrollments
        FROM students st
        LEFT JOIN users su ON su.id=st.user_id
        LEFT JOIN LATERAL (
          SELECT created_at,expires_at,accepted_at FROM user_invitations i
          WHERE i.user_id=su.id ORDER BY i.created_at DESC LIMIT 1
        ) sinv ON true
        LEFT JOIN student_manager_assignments sma ON sma.student_id=st.id AND sma.ended_at IS NULL
        LEFT JOIN staff_profiles sm ON sm.user_id=sma.manager_user_id
        LEFT JOIN student_subject_enrollments e ON e.student_id=st.id
        LEFT JOIN subjects sub ON sub.id=e.subject_id
        LEFT JOIN teacher_assignments ta ON ta.enrollment_id=e.id AND ta.ended_at IS NULL
        LEFT JOIN teacher_profiles tp ON tp.user_id=ta.teacher_id
        LEFT JOIN balances b ON b.id=e.id
        WHERE st.family_id=${familyId}
        GROUP BY st.id,su.id,sinv.created_at,sinv.expires_at,sinv.accepted_at,sma.manager_user_id,sm.first_name,sm.last_name
        ORDER BY st.last_name,st.first_name
      `),
      this.db.execute(sql`
        SELECT o.id,
               o.created_at AS "createdAt",
               o.paid_at AS "paidAt",
               o.source,
               o.status,
               o.subtotal_minor AS "subtotalMinor",
               o.discount_minor AS "discountMinor",
               o.total_minor AS "totalMinor",
               o.currency,
               p.method AS "paymentMethod",
               CASE
                 WHEN lt.id IS NOT NULL THEN 'LESSON_TOPUP'
                 WHEN flo.id IS NOT NULL THEN 'FIRST_LESSON'
                 WHEN cp.id IS NOT NULL THEN 'COURSE'
                 ELSE 'OTHER'
               END AS "productType",
               COALESCE(st.id, fst.id) AS "studentId",
               COALESCE(st.first_name, fst.first_name) AS "studentFirstName",
               COALESCE(st.last_name, fst.last_name) AS "studentLastName",
               COALESCE(sub.name, fsub.name) AS "subjectName",
               lt.lesson_units AS "lessonUnits",
               c.title AS "courseTitle"
        FROM orders o
        LEFT JOIN LATERAL (
          SELECT p.method FROM payments p WHERE p.order_id=o.id ORDER BY p.created_at DESC LIMIT 1
        ) p ON true
        LEFT JOIN lesson_topups lt ON lt.order_id=o.id
        LEFT JOIN student_subject_enrollments e ON e.id=lt.enrollment_id
        LEFT JOIN students st ON st.id=e.student_id
        LEFT JOIN subjects sub ON sub.id=e.subject_id
        LEFT JOIN first_lesson_orders flo ON flo.order_id=o.id
        LEFT JOIN live_sessions fls ON fls.id=flo.session_id
        LEFT JOIN students fst ON fst.id=fls.student_id
        LEFT JOIN subjects fsub ON fsub.id=fls.subject_id
        LEFT JOIN course_purchases cp ON cp.order_id=o.id
        LEFT JOIN courses c ON c.id=cp.course_id
        WHERE o.family_id=${familyId}
        ORDER BY o.created_at DESC
        LIMIT 300
      `),
      this.db.execute(sql`
        SELECT cl.id,
               cl.status,
               cl.starts_at AS "startsAt",
               cl.ends_at AS "endsAt",
               cl.explanations_enabled AS "explanationsEnabled",
               c.id AS "courseId",
               c.title AS "courseTitle",
               COALESCE(
                 jsonb_agg(
                   jsonb_build_object(
                     'studentId', st.id,
                     'firstName', st.first_name,
                     'lastName', st.last_name,
                     'grantedAt', ce.granted_at
                   ) ORDER BY st.last_name,st.first_name
                 ) FILTER (WHERE ce.id IS NOT NULL),
                 '[]'::jsonb
               ) AS students
        FROM course_licenses cl
        JOIN courses c ON c.id=cl.course_id
        LEFT JOIN course_enrollments ce ON ce.license_id=cl.id
        LEFT JOIN students st ON st.id=ce.student_id
        WHERE cl.family_id=${familyId}
        GROUP BY cl.id,c.id,c.title
        ORDER BY cl.created_at DESC
      `),
    ]);

    const activityResult = await this.db.execute(sql`
      WITH child_ids AS (
        SELECT id FROM students WHERE family_id=${familyId}
      ), enrollment_ids AS (
        SELECT id FROM student_subject_enrollments WHERE student_id IN (SELECT id FROM child_ids)
      ), related_entities AS (
        SELECT ${familyId}::uuid AS id
        UNION SELECT id FROM child_ids
        UNION SELECT id FROM enrollment_ids
        UNION SELECT sma.id FROM student_manager_assignments sma WHERE sma.student_id IN (SELECT id FROM child_ids)
        UNION SELECT ta.id FROM teacher_assignments ta WHERE ta.enrollment_id IN (SELECT id FROM enrollment_ids)
        UNION SELECT lt.id FROM lesson_topups lt WHERE lt.enrollment_id IN (SELECT id FROM enrollment_ids)
        UNION SELECT lct.id FROM lesson_credit_transfers lct
          WHERE lct.from_enrollment_id IN (SELECT id FROM enrollment_ids)
             OR lct.to_enrollment_id IN (SELECT id FROM enrollment_ids)
      )
      SELECT a.id,
             a.action,
             a.entity_type AS "entityType",
             a.entity_id AS "entityId",
             a.actor_role_code AS "actorRole",
             a.created_at AS "createdAt",
             COALESCE(
               NULLIF(concat_ws(' ', sp.first_name, sp.last_name), ''),
               NULLIF(concat_ws(' ', tp.first_name, tp.last_name), ''),
               NULLIF(concat_ws(' ', pp.first_name, pp.last_name), ''),
               u.email,
               'SYSTEM'
             ) AS "actorName"
      FROM audit_logs a
      LEFT JOIN users u ON u.id=a.actor_user_id
      LEFT JOIN staff_profiles sp ON sp.user_id=a.actor_user_id
      LEFT JOIN teacher_profiles tp ON tp.user_id=a.actor_user_id
      LEFT JOIN parent_profiles pp ON pp.user_id=a.actor_user_id
      WHERE a.entity_id IN (SELECT id FROM related_entities)
         OR (a.after_data->>'familyId')=${familyId}
         OR (a.before_data->>'familyId')=${familyId}
      ORDER BY a.created_at DESC
      LIMIT 120
    `);

    const children = childrenResult.rows as any[];
    const activeEnrollmentCount = children.reduce(
      (sum, child) => sum + ((child.enrollments as any[]) ?? []).filter((item) => item.status === "ACTIVE").length,
      0,
    );
    const totalBalanceLessonUnits = children.reduce(
      (sum, child) => sum + ((child.enrollments as any[]) ?? []).reduce((acc, item) => acc + Number(item.balanceLessonUnits ?? 0), 0),
      0,
    );
    const hasActiveCourse = (courseResult.rows as any[]).some((course) => course.status === "ACTIVE" && new Date(course.endsAt) > new Date());

    return {
      family: familyResult.rows[0],
      status: (familyResult.rows[0] as any).archivedAt ? "ARCHIVED" : activeEnrollmentCount > 0 || hasActiveCourse ? "ACTIVE" : "INACTIVE",
      summary: {
        children: children.length,
        activeEnrollments: activeEnrollmentCount,
        totalBalanceLessonUnits,
        activeCourses: (courseResult.rows as any[]).filter((course) => course.status === "ACTIVE" && new Date(course.endsAt) > new Date()).length,
      },
      children,
      purchases: purchaseResult.rows.map((purchase: any) => ({
        ...purchase,
        studentId: purchase.studentId ?? null,
        studentFirstName: purchase.studentFirstName ?? null,
        studentLastName: purchase.studentLastName ?? null,
      })),
      courses: courseResult.rows,
      activity: activityResult.rows,
    };
  }
}
