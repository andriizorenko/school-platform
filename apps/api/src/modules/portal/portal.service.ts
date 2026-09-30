import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Database } from "@school/db";
import { DATABASE } from "../../common/database/database.constants";
import type { AuthUser } from "../auth/types";
import { sql } from "drizzle-orm";

@Injectable()
export class PortalService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async parentDashboard(actor: AuthUser) {
    if (!actor.roles.includes("PARENT")) {
      throw new ForbiddenException({ code: "PARENT_PORTAL_ONLY", message: "Parent dashboard is available only to a parent account" });
    }

    const parentResult = await this.db.execute(sql`
      SELECT pp.user_id, pp.family_id, pp.first_name, pp.last_name, pp.phone, u.email
      FROM parent_profiles pp
      JOIN users u ON u.id = pp.user_id
      WHERE pp.user_id = ${actor.id}
      LIMIT 1
    `);
    if (!parentResult.rowCount) throw new NotFoundException({ code: "PARENT_PROFILE_NOT_FOUND", message: "Parent profile not found" });
    const parent = parentResult.rows[0] as any;

    const studentResult = await this.db.execute(sql`
      SELECT
        st.id, st.user_id, st.first_name, st.last_name, st.birth_date, st.grade_level,
        sma.manager_user_id,
        sp.first_name AS manager_first_name,
        sp.last_name AS manager_last_name,
        sp.phone AS manager_phone
      FROM students st
      LEFT JOIN student_manager_assignments sma ON sma.student_id = st.id AND sma.ended_at IS NULL
      LEFT JOIN staff_profiles sp ON sp.user_id = sma.manager_user_id
      WHERE st.family_id = ${parent.family_id}
        AND st.archived_at IS NULL
      ORDER BY st.first_name, st.last_name
    `);

    const enrollmentResult = await this.db.execute(sql`
      SELECT
        e.id,
        e.student_id,
        e.status,
        e.default_duration_minutes,
        sub.id AS subject_id,
        sub.name AS subject_name,
        ta.teacher_id,
        tp.first_name AS teacher_first_name,
        tp.last_name AS teacher_last_name,
        tp.phone AS teacher_phone,
        tp.zoom_url,
        tc.username AS teacher_telegram_username,
        (
          COALESCE((SELECT SUM(g.credits_granted) FROM lesson_credit_grants g WHERE g.enrollment_id = e.id), 0)
          - COALESCE((SELECT SUM(d.credits_debited) FROM lesson_credit_debits d WHERE d.enrollment_id = e.id), 0)
        )::int AS balance_credits,
        (
          SELECT MIN(ls.starts_at)
          FROM live_sessions ls
          WHERE ls.enrollment_id = e.id
            AND ls.status = 'SCHEDULED'
            AND ls.starts_at > now()
        ) AS next_lesson_at
      FROM student_subject_enrollments e
      JOIN students st ON st.id = e.student_id
      JOIN subjects sub ON sub.id = e.subject_id
      LEFT JOIN teacher_assignments ta ON ta.enrollment_id = e.id AND ta.ended_at IS NULL
      LEFT JOIN teacher_profiles tp ON tp.user_id = ta.teacher_id
      LEFT JOIN telegram_connections tc ON tc.user_id = ta.teacher_id AND tc.status = 'ACTIVE'
      WHERE st.family_id = ${parent.family_id}
      ORDER BY st.id, sub.name
    `);

    const nextLessons = await this.db.execute(sql`
      SELECT ls.id, ls.student_id, ls.starts_at, ls.ends_at, ls.session_type, ls.funding_status,
             st.first_name AS student_first_name, st.last_name AS student_last_name,
             sub.name AS subject_name, tp.first_name AS teacher_first_name, tp.last_name AS teacher_last_name, tp.zoom_url
      FROM live_sessions ls
      JOIN students st ON st.id = ls.student_id
      JOIN subjects sub ON sub.id = ls.subject_id
      JOIN teacher_profiles tp ON tp.user_id = ls.actual_teacher_id
      WHERE st.family_id = ${parent.family_id}
        AND ls.status = 'SCHEDULED'
        AND ls.starts_at > now()
      ORDER BY ls.starts_at ASC
      LIMIT 10
    `);

    const recentReschedules = await this.db.execute(sql`
      SELECT r.id, r.session_id, r.from_start_at, r.to_start_at, r.created_at,
             st.first_name AS student_first_name, st.last_name AS student_last_name,
             sub.name AS subject_name
      FROM session_reschedules r
      JOIN live_sessions ls ON ls.id = r.session_id
      JOIN students st ON st.id = ls.student_id
      JOIN subjects sub ON sub.id = ls.subject_id
      WHERE st.family_id = ${parent.family_id}
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT 5
    `);

    const enrollmentsByStudent = new Map<string, any[]>();
    for (const enrollment of enrollmentResult.rows as any[]) {
      const list = enrollmentsByStudent.get(enrollment.student_id) ?? [];
      list.push({
        id: enrollment.id,
        status: enrollment.status,
        defaultDurationMinutes: enrollment.default_duration_minutes,
        subject: { id: enrollment.subject_id, name: enrollment.subject_name },
        balanceLessonUnits: Number(enrollment.balance_credits) / 2,
        nextLessonAt: enrollment.next_lesson_at,
        primaryTeacher: enrollment.teacher_id ? {
          id: enrollment.teacher_id,
          firstName: enrollment.teacher_first_name,
          lastName: enrollment.teacher_last_name,
          phone: enrollment.teacher_phone,
          zoomUrl: enrollment.zoom_url,
          telegramUsername: enrollment.teacher_telegram_username,
        } : null,
      });
      enrollmentsByStudent.set(enrollment.student_id, list);
    }

    return {
      parent: {
        userId: parent.user_id,
        firstName: parent.first_name,
        lastName: parent.last_name,
        phone: parent.phone,
        email: parent.email,
      },
      students: (studentResult.rows as any[]).map((student) => ({
        id: student.id,
        userId: student.user_id,
        firstName: student.first_name,
        lastName: student.last_name,
        birthDate: student.birth_date,
        gradeLevel: student.grade_level,
        primaryManager: student.manager_user_id ? {
          userId: student.manager_user_id,
          firstName: student.manager_first_name,
          lastName: student.manager_last_name,
          phone: student.manager_phone,
        } : null,
        enrollments: enrollmentsByStudent.get(student.id) ?? [],
      })),
      nextLessons: nextLessons.rows,
      recentReschedules: recentReschedules.rows,
    };
  }

  async parentReschedules(actor: AuthUser, before?: string, limit?: string) {
    if (!actor.roles.includes("PARENT")) {
      throw new ForbiddenException({ code: "PARENT_PORTAL_ONLY", message: "Reschedule history is available only to a parent account" });
    }

    const pageSize = limit === undefined ? 20 : Number(limit);
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
      throw new BadRequestException({ code: "INVALID_RESCHEDULE_PAGE_SIZE", message: "Limit must be an integer from 1 to 50" });
    }

    let cursorAt: string | null = null;
    let cursorId: string | null = null;
    if (before !== undefined) {
      if (before.length > 160 || !/^[A-Za-z0-9_-]+$/.test(before)
        || Buffer.from(before, "base64url").toString("base64url") !== before) {
        throw new BadRequestException({ code: "INVALID_RESCHEDULE_CURSOR", message: "Invalid history cursor" });
      }
      const decoded = Buffer.from(before, "base64url").toString("utf8").split("|");
      if (decoded.length !== 2
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(decoded[0])
        || !Number.isFinite(Date.parse(decoded[0]))
        || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(decoded[1])) {
        throw new BadRequestException({ code: "INVALID_RESCHEDULE_CURSOR", message: "Invalid history cursor" });
      }
      [cursorAt, cursorId] = decoded;
    }

    const family = await this.db.execute(sql`SELECT family_id FROM parent_profiles WHERE user_id=${actor.id} LIMIT 1`);
    if (!family.rowCount) throw new NotFoundException({ code: "PARENT_PROFILE_NOT_FOUND", message: "Parent profile not found" });
    const familyId = (family.rows[0] as any).family_id;

    const result = await this.db.execute(sql`
      SELECT r.id, r.session_id, r.from_start_at, r.to_start_at, r.created_at,
             to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at,
             st.first_name AS student_first_name, st.last_name AS student_last_name,
             sub.name AS subject_name
      FROM session_reschedules r
      JOIN live_sessions ls ON ls.id = r.session_id
      JOIN students st ON st.id = ls.student_id
      JOIN subjects sub ON sub.id = ls.subject_id
      WHERE st.family_id = ${familyId}
        ${cursorAt && cursorId ? sql`AND (r.created_at, r.id) < (${cursorAt}::timestamptz, ${cursorId}::uuid)` : sql``}
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT ${pageSize + 1}
    `);
    const rows = result.rows as any[];
    const visible = rows.slice(0, pageSize);
    const last = visible.at(-1);
    return {
      items: visible.map(({ cursor_at, ...item }) => item),
      nextCursor: rows.length > pageSize && last
        ? Buffer.from(`${last.cursor_at}|${last.id}`, "utf8").toString("base64url")
        : null,
    };
  }

  async parentPayments(actor: AuthUser) {
    if (!actor.roles.includes("PARENT")) {
      throw new ForbiddenException({ code: "PARENT_PORTAL_ONLY", message: "Parent payments are available only to a parent account" });
    }
    const family = await this.db.execute(sql`SELECT family_id FROM parent_profiles WHERE user_id=${actor.id} LIMIT 1`);
    if (!family.rowCount) throw new NotFoundException({ code: "PARENT_PROFILE_NOT_FOUND", message: "Parent profile not found" });
    const familyId = (family.rows[0] as any).family_id;
    const rows = await this.db.execute(sql`
      SELECT
        o.id, o.status, o.source, o.currency, o.subtotal_minor, o.discount_minor, o.total_minor,
        o.created_at, o.paid_at,
        CASE WHEN lt.id IS NOT NULL OR lci.id IS NOT NULL THEN 'LESSONS' WHEN cp.id IS NOT NULL THEN 'COURSE' ELSE 'OTHER' END AS product_type,
        COALESCE(lt.lesson_units, lci.lesson_units) AS lesson_units,
        st.id AS student_id, st.first_name AS student_first_name, st.last_name AS student_last_name,
        sub.name AS subject_name,
        c.title AS course_title,
        op.promotion_name_snapshot AS promotion_name,
        p.method AS payment_method, p.status AS payment_status, p.provider AS payment_provider,
        p.provider_status AS payment_provider_status, COALESCE(p.refunded_minor,0)::bigint AS refunded_minor
      FROM orders o
      LEFT JOIN lesson_topups lt ON lt.order_id=o.id
      LEFT JOIN lesson_checkout_intents lci ON lci.order_id=o.id
      LEFT JOIN student_subject_enrollments e ON e.id=COALESCE(lt.enrollment_id,lci.enrollment_id)
      LEFT JOIN students st ON st.id=e.student_id
      LEFT JOIN subjects sub ON sub.id=e.subject_id
      LEFT JOIN course_purchases cp ON cp.order_id=o.id
      LEFT JOIN courses c ON c.id=cp.course_id
      LEFT JOIN order_promotions op ON op.order_id=o.id
      LEFT JOIN LATERAL (
        SELECT method,status,provider,provider_status,refunded_minor FROM payments px WHERE px.order_id=o.id ORDER BY px.created_at DESC LIMIT 1
      ) p ON true
      WHERE o.family_id=${familyId}
      ORDER BY o.created_at DESC
      LIMIT 200
    `);
    return rows.rows;
  }

  async studentDashboard(actor: AuthUser) {
    if (!actor.roles.includes("STUDENT")) {
      throw new ForbiddenException({ code: "STUDENT_PORTAL_ONLY", message: "Student dashboard is available only to a student account" });
    }

    const studentResult = await this.db.execute(sql`
      SELECT id, first_name, last_name, birth_date, grade_level
      FROM students
      WHERE user_id = ${actor.id}
        AND archived_at IS NULL
      LIMIT 1
    `);
    if (!studentResult.rowCount) throw new NotFoundException({ code: "STUDENT_PROFILE_NOT_FOUND", message: "Student profile not found" });
    const student = studentResult.rows[0] as any;

    const enrollments = await this.db.execute(sql`
      SELECT
        e.id, e.status, e.default_duration_minutes,
        sub.id AS subject_id, sub.name AS subject_name,
        ta.teacher_id,
        tp.first_name AS teacher_first_name,
        tp.last_name AS teacher_last_name,
        tp.phone AS teacher_phone,
        tp.zoom_url,
        tc.username AS teacher_telegram_username,
        (
          COALESCE((SELECT SUM(g.credits_granted) FROM lesson_credit_grants g WHERE g.enrollment_id = e.id), 0)
          - COALESCE((SELECT SUM(d.credits_debited) FROM lesson_credit_debits d WHERE d.enrollment_id = e.id), 0)
        )::int AS balance_credits
      FROM student_subject_enrollments e
      JOIN subjects sub ON sub.id = e.subject_id
      LEFT JOIN teacher_assignments ta ON ta.enrollment_id = e.id AND ta.ended_at IS NULL
      LEFT JOIN teacher_profiles tp ON tp.user_id = ta.teacher_id
      LEFT JOIN telegram_connections tc ON tc.user_id = ta.teacher_id AND tc.status = 'ACTIVE'
      WHERE e.student_id = ${student.id}
      ORDER BY sub.name
    `);

    const nextLessons = await this.db.execute(sql`
      SELECT ls.id, ls.starts_at, ls.ends_at, ls.session_type, ls.funding_status,
             sub.id AS subject_id, sub.name AS subject_name,
             tp.user_id AS teacher_id, tp.first_name AS teacher_first_name, tp.last_name AS teacher_last_name,
             tp.phone AS teacher_phone, tp.zoom_url, tc.username AS teacher_telegram_username
      FROM live_sessions ls
      JOIN subjects sub ON sub.id = ls.subject_id
      JOIN teacher_profiles tp ON tp.user_id = ls.actual_teacher_id
      LEFT JOIN telegram_connections tc ON tc.user_id = ls.actual_teacher_id AND tc.status = 'ACTIVE'
      WHERE ls.student_id = ${student.id}
        AND ls.status = 'SCHEDULED'
        AND ls.starts_at > now()
      ORDER BY ls.starts_at ASC
      LIMIT 10
    `);

    return {
      student,
      enrollments: (enrollments.rows as any[]).map((enrollment) => ({
        id: enrollment.id,
        status: enrollment.status,
        defaultDurationMinutes: enrollment.default_duration_minutes,
        subject: { id: enrollment.subject_id, name: enrollment.subject_name },
        balanceLessonUnits: Number(enrollment.balance_credits) / 2,
        primaryTeacher: enrollment.teacher_id ? {
          id: enrollment.teacher_id,
          firstName: enrollment.teacher_first_name,
          lastName: enrollment.teacher_last_name,
          phone: enrollment.teacher_phone,
          zoomUrl: enrollment.zoom_url,
          telegramUsername: enrollment.teacher_telegram_username,
        } : null,
      })),
      nextLessons: (nextLessons.rows as any[]).map((lesson) => ({
        id: lesson.id,
        startsAt: lesson.starts_at,
        endsAt: lesson.ends_at,
        sessionType: lesson.session_type,
        fundingStatus: lesson.funding_status,
        subjectId: lesson.subject_id,
        subjectName: lesson.subject_name,
        teacherId: lesson.teacher_id,
        teacherFirstName: lesson.teacher_first_name,
        teacherLastName: lesson.teacher_last_name,
        teacherPhone: lesson.teacher_phone,
        teacherTelegramUsername: lesson.teacher_telegram_username,
        zoomUrl: lesson.zoom_url,
      })),
    };
  }
}
