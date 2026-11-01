import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import type { Database } from "@school/db";
import { sql } from "drizzle-orm";
import { DATABASE } from "../../common/database/database.constants";
import type { AuthUser } from "../auth/types";
import { AuditService } from "../audit/audit.service";
import { OutboxService } from "../audit/outbox.service";
import type { CreateLeadDto } from "./dto/create-lead.dto";
import type { UpdateLeadDto } from "./dto/update-lead.dto";
import type { CreateTeacherApplicationDto } from "./dto/create-teacher-application.dto";

@Injectable()
export class OpsService {
  constructor(@Inject(DATABASE) private readonly db: Database, private readonly audit: AuditService, private readonly outbox: OutboxService) {}

  async dashboard(actor: AuthUser) {
    if (!actor.roles.some((role) => ["ADMIN","MANAGER","SUPPORT_MANAGER"].includes(role))) {
      throw new ForbiddenException({ code:"OPS_DASHBOARD_DENIED",message:"Operational dashboard is not available for this account" });
    }
    const canViewFinance = actor.roles.includes("ADMIN");
    const [metrics, attention, learning, finance, payroll] = await Promise.all([
      this.db.execute(sql`
        SELECT
          (SELECT COUNT(DISTINCT st.id)::int
           FROM students st
           WHERE st.archived_at IS NULL AND (
             EXISTS (SELECT 1 FROM student_subject_enrollments e WHERE e.student_id=st.id AND e.status='ACTIVE')
             OR EXISTS (
               SELECT 1 FROM course_enrollments ce
               JOIN course_licenses cl ON cl.id=ce.license_id
               WHERE ce.student_id=st.id AND cl.status='ACTIVE' AND cl.ends_at>now()
             )
           )) AS active_students,
          (SELECT COUNT(*)::int FROM teacher_profiles WHERE archived_at IS NULL AND status <> 'ARCHIVED') AS teachers,
          (SELECT COUNT(*)::int FROM staff_profiles sp JOIN user_roles ur ON ur.user_id=sp.user_id JOIN roles r ON r.id=ur.role_id WHERE r.code='MANAGER' AND sp.archived_at IS NULL) AS managers,
          (SELECT COUNT(*)::int FROM live_sessions
           WHERE (starts_at AT TIME ZONE 'Europe/Kyiv')::date=(now() AT TIME ZONE 'Europe/Kyiv')::date
             AND status IN ('SCHEDULED','COMPLETED','CHARGED_NO_SHOW')) AS lessons_today,
          (SELECT COUNT(*)::int FROM live_sessions
           WHERE session_type='FIRST'
             AND (starts_at AT TIME ZONE 'Europe/Kyiv')::date >= date_trunc('month', now() AT TIME ZONE 'Europe/Kyiv')::date
             AND (starts_at AT TIME ZONE 'Europe/Kyiv')::date < (date_trunc('month', now() AT TIME ZONE 'Europe/Kyiv') + interval '1 month')::date
             AND status NOT IN ('CANCELLED','EXPIRED_UNPAID')) AS first_lessons_month,
          (SELECT COUNT(*)::int FROM course_licenses WHERE status='ACTIVE' AND ends_at > now()) AS active_course_licenses
      `),
      this.db.execute(sql`
        WITH balances AS (
          SELECT e.id,
            COALESCE((SELECT SUM(g.credits_granted) FROM lesson_credit_grants g WHERE g.enrollment_id=e.id),0)
            - COALESCE((SELECT SUM(d.credits_debited) FROM lesson_credit_debits d WHERE d.enrollment_id=e.id),0) AS credits
          FROM student_subject_enrollments e WHERE e.status='ACTIVE'
        ), settings AS (
          SELECT COALESCE((SELECT (value #>> '{}')::int FROM school_settings WHERE key='low_balance_lesson_units'),3) AS low_units
        )
        SELECT
          (SELECT COUNT(*)::int FROM balances WHERE credits=0) AS zero_balance,
          (SELECT COUNT(*)::int FROM balances,settings WHERE credits > 0 AND credits <= low_units*2) AS low_balance,
          (SELECT COUNT(*)::int FROM live_sessions WHERE funding_status='BOOKED' AND status='SCHEDULED' AND starts_at > now()) AS booked_unpaid,
          (SELECT COUNT(*)::int FROM live_sessions WHERE status='SCHEDULED' AND ends_at < now() AND marked_at IS NULL AND session_type='REGULAR') AS unmarked_lessons,
          (SELECT COUNT(*)::int FROM teacher_vacation_requests WHERE status='PENDING') AS pending_vacations,
          (SELECT COUNT(*)::int FROM leads WHERE status='NEW') AS new_leads,
          (SELECT COUNT(*)::int FROM teacher_profiles tp WHERE tp.archived_at IS NULL AND tp.status <> 'ARCHIVED' AND NOT EXISTS (SELECT 1 FROM teacher_payout_details pd WHERE pd.teacher_id=tp.user_id AND pd.is_active=true)) AS missing_payout_details
      `),
      this.db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE status='COMPLETED')::int AS conducted,
          COUNT(*) FILTER (WHERE status='COMPLETED' AND session_type='REGULAR')::int AS regular_conducted,
          COUNT(*) FILTER (WHERE status='COMPLETED' AND session_type='FIRST')::int AS first_conducted,
          COUNT(*) FILTER (WHERE status='COMPLETED' AND EXTRACT(EPOCH FROM (ends_at-starts_at))/60=30)::int AS thirty_minute,
          COUNT(*) FILTER (WHERE status='CHARGED_NO_SHOW')::int AS charged_no_show,
          (SELECT COUNT(*)::int FROM payroll_accruals WHERE type='COMPENSATION' AND earned_for_date >= (date_trunc('month', now() AT TIME ZONE 'Europe/Kyiv'))::date AND earned_for_date <= (now() AT TIME ZONE 'Europe/Kyiv')::date) AS compensation
        FROM live_sessions
        WHERE (starts_at AT TIME ZONE 'Europe/Kyiv')::date >= date_trunc('month', now() AT TIME ZONE 'Europe/Kyiv')::date
          AND (starts_at AT TIME ZONE 'Europe/Kyiv')::date < (date_trunc('month', now() AT TIME ZONE 'Europe/Kyiv') + interval '1 month')::date
      `),
      this.db.execute(sql`
        SELECT
          COALESCE((SELECT SUM(o.total_minor - COALESCE((SELECT SUM(px.refunded_minor) FROM payments px WHERE px.order_id=o.id),0)) FROM orders o WHERE o.status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED')),0)::bigint AS lifetime_revenue_minor,
          COALESCE((SELECT SUM(amount_minor) FROM payroll_accruals),0)::bigint AS lifetime_teacher_accrual_minor,
          COALESCE((SELECT SUM(o.total_minor - COALESCE((SELECT SUM(px.refunded_minor) FROM payments px WHERE px.order_id=o.id),0)) FROM orders o WHERE o.status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED') AND (o.paid_at AT TIME ZONE 'Europe/Kyiv')::date >= date_trunc('month',now() AT TIME ZONE 'Europe/Kyiv')::date AND (o.paid_at AT TIME ZONE 'Europe/Kyiv')::date < (date_trunc('month',now() AT TIME ZONE 'Europe/Kyiv')+interval '1 month')::date),0)::bigint AS month_revenue_minor,
          COALESCE((SELECT SUM(amount_minor) FROM payroll_accruals WHERE earned_for_date >= (date_trunc('month',now() AT TIME ZONE 'Europe/Kyiv'))::date AND earned_for_date <= (now() AT TIME ZONE 'Europe/Kyiv')::date),0)::bigint AS month_teacher_accrual_minor
      `),
      this.db.execute(sql`
        SELECT pp.id,pp.period_start,pp.period_end,pp.payout_window_start,pp.payout_window_end,pp.status,
          COUNT(p.id) FILTER (WHERE p.status<>'PAID')::int AS pending_payouts,
          COALESCE(SUM(p.amount_snapshot_minor) FILTER (WHERE p.status<>'PAID'),0)::bigint AS pending_amount_minor
        FROM payroll_periods pp
        LEFT JOIN teacher_payouts p ON p.payroll_period_id=pp.id
        WHERE pp.payout_window_start <= (now() AT TIME ZONE 'Europe/Kyiv')::date
          AND pp.payout_window_end >= (now() AT TIME ZONE 'Europe/Kyiv')::date
        GROUP BY pp.id
        ORDER BY pp.period_start DESC LIMIT 1
      `),
    ]);
    const f = finance.rows[0] as any;
    const monthRevenue = Number(f.month_revenue_minor ?? 0);
    const monthAccrual = Number(f.month_teacher_accrual_minor ?? 0);
    const lifetimeRevenue = Number(f.lifetime_revenue_minor ?? 0);
    const lifetimeAccrual = Number(f.lifetime_teacher_accrual_minor ?? 0);
    return {
      metrics: metrics.rows[0],
      attention: attention.rows[0],
      learning: learning.rows[0],
      finance: canViewFinance ? {
        ...f,
        monthOperatingDifferenceMinor: monthRevenue - monthAccrual,
        lifetimeOperatingDifferenceMinor: lifetimeRevenue - lifetimeAccrual,
      } : null,
      payrollWindow: canViewFinance ? (payroll.rows[0] ?? null) : null,
      actorScope: actor.roles.includes("MANAGER") ? "MANAGER" : "SCHOOL",
    };
  }

  async families(input: { search?: string; manager?: string; lifecycle?: string }, actor: AuthUser) {
    if (!actor.roles.some((role) => ["ADMIN", "MANAGER", "SUPPORT_MANAGER"].includes(role))) {
      throw new ForbiddenException({ code: "OPS_FAMILY_LIST_DENIED", message: "Operational family list is not available for this account" });
    }
    const managerScope = actor.roles.includes("MANAGER") && input.manager === "mine" ? actor.id : null;
    const search = input.search?.trim() ? `%${input.search.trim()}%` : null;
    const lifecycle = input.lifecycle === "ARCHIVED" ? "ARCHIVED" : input.lifecycle === "ALL" ? "ALL" : "ACTIVE";
    const result = await this.db.execute(sql`
      SELECT f.id,f.created_at AS "createdAt",f.archived_at AS "archivedAt",
             pp.user_id AS "parentUserId",pp.first_name AS "parentFirstName",pp.last_name AS "parentLastName",pp.phone AS "parentPhone",
             u.email AS "parentEmail",u.status AS "parentAccountStatus",
             COUNT(DISTINCT st.id)::int AS "childrenCount",
             COUNT(DISTINCT st.id) FILTER (WHERE st.archived_at IS NULL)::int AS "activeChildrenCount",
             COUNT(DISTINCT e.id) FILTER (WHERE e.status='ACTIVE')::int AS "activeEnrollmentsCount",
             COALESCE(jsonb_agg(DISTINCT jsonb_build_object('id',st.id,'firstName',st.first_name,'lastName',st.last_name,'archivedAt',st.archived_at)) FILTER (WHERE st.id IS NOT NULL),'[]'::jsonb) AS children,
             COALESCE(jsonb_agg(DISTINCT jsonb_build_object('userId',sm.user_id,'firstName',sm.first_name,'lastName',sm.last_name)) FILTER (WHERE sm.user_id IS NOT NULL),'[]'::jsonb) AS managers
      FROM families f
      JOIN parent_profiles pp ON pp.family_id=f.id
      JOIN users u ON u.id=pp.user_id
      LEFT JOIN students st ON st.family_id=f.id
      LEFT JOIN student_manager_assignments sma ON sma.student_id=st.id AND sma.ended_at IS NULL
      LEFT JOIN staff_profiles sm ON sm.user_id=sma.manager_user_id
      LEFT JOIN student_subject_enrollments e ON e.student_id=st.id
      WHERE (${search}::text IS NULL OR concat_ws(' ',pp.first_name,pp.last_name,pp.phone,u.email) ILIKE ${search}
             OR EXISTS (SELECT 1 FROM students s2 WHERE s2.family_id=f.id AND concat_ws(' ',s2.first_name,s2.last_name) ILIKE ${search}))
        AND (${managerScope}::uuid IS NULL OR EXISTS (
          SELECT 1 FROM students s3 JOIN student_manager_assignments sma3 ON sma3.student_id=s3.id AND sma3.ended_at IS NULL
          WHERE s3.family_id=f.id AND sma3.manager_user_id=${managerScope}
        ))
        AND ((${lifecycle}='ALL') OR (${lifecycle}='ARCHIVED' AND f.archived_at IS NOT NULL) OR (${lifecycle}='ACTIVE' AND f.archived_at IS NULL))
      GROUP BY f.id,pp.user_id,u.id
      ORDER BY f.archived_at NULLS FIRST,pp.last_name,pp.first_name
      LIMIT 300
    `);
    return result.rows;
  }

  async students(input: { search?: string; manager?: string; status?: string; subject?: string; teacher?: string; balance?: string; lifecycle?: string }, actor: AuthUser) {
    if (actor.roles.includes("PARENT") || actor.roles.includes("STUDENT")) throw new ForbiddenException({code:"OPS_STUDENT_LIST_DENIED",message:"Operational student list is not available for this account"});
    const managerScope = actor.roles.includes("MANAGER") && input.manager === "mine" ? actor.id : null;
    const teacherScope = actor.roles.includes("TEACHER") ? actor.id : null;
    const search = input.search?.trim() ? `%${input.search.trim()}%` : null;
    const result = await this.db.execute(sql`
      WITH balances AS (
        SELECT e.id,
          (COALESCE((SELECT SUM(g.credits_granted) FROM lesson_credit_grants g WHERE g.enrollment_id=e.id),0)
          - COALESCE((SELECT SUM(d.credits_debited) FROM lesson_credit_debits d WHERE d.enrollment_id=e.id),0))::int credits
        FROM student_subject_enrollments e
      )
      SELECT st.id, st.first_name, st.last_name, st.grade_level, st.user_id, st.archived_at,
        pp.first_name parent_first_name, pp.last_name parent_last_name, pp.phone parent_phone,
        sma.manager_user_id, sm.first_name manager_first_name, sm.last_name manager_last_name,
        COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
          'id',e.id,'status',e.status,'subjectId',sub.id,'subjectName',sub.name,
          'teacherId',ta.teacher_id,'teacherName',concat_ws(' ',tp.first_name,tp.last_name),
          'balanceCredits',b.credits,'balanceLessonUnits',b.credits/2.0
        )) FILTER (WHERE e.id IS NOT NULL),'[]'::jsonb) enrollments
      FROM students st
      JOIN families f ON f.id=st.family_id
      JOIN parent_profiles pp ON pp.family_id=f.id
      LEFT JOIN student_manager_assignments sma ON sma.student_id=st.id AND sma.ended_at IS NULL
      LEFT JOIN staff_profiles sm ON sm.user_id=sma.manager_user_id
      LEFT JOIN student_subject_enrollments e ON e.student_id=st.id
      LEFT JOIN subjects sub ON sub.id=e.subject_id
      LEFT JOIN teacher_assignments ta ON ta.enrollment_id=e.id AND ta.ended_at IS NULL
      LEFT JOIN teacher_profiles tp ON tp.user_id=ta.teacher_id
      LEFT JOIN balances b ON b.id=e.id
      WHERE ((${input.lifecycle ?? "ACTIVE"}::text='ALL') OR (${input.lifecycle ?? "ACTIVE"}::text='ARCHIVED' AND st.archived_at IS NOT NULL) OR (${input.lifecycle ?? "ACTIVE"}::text<>'ARCHIVED' AND ${input.lifecycle ?? "ACTIVE"}::text<>'ALL' AND st.archived_at IS NULL))
        AND (${search}::text IS NULL OR concat_ws(' ',st.first_name,st.last_name,pp.first_name,pp.last_name,pp.phone) ILIKE ${search})
        AND (${managerScope}::uuid IS NULL OR sma.manager_user_id=${managerScope})
        AND (${input.subject ?? null}::uuid IS NULL OR e.subject_id=${input.subject ?? null})
        AND (${teacherScope}::uuid IS NULL OR ta.teacher_id=${teacherScope})
        AND (${input.teacher ?? null}::uuid IS NULL OR ta.teacher_id=${input.teacher ?? null})
        AND (${input.status ?? null}::text IS NULL OR e.status::text=${input.status ?? null})
        AND (${input.balance ?? null}::text IS NULL OR
          (${input.balance ?? null}='ZERO' AND b.credits=0) OR
          (${input.balance ?? null}='LOW' AND b.credits > 0 AND b.credits <= 6) OR
          (${input.balance ?? null}='POSITIVE' AND b.credits > 6))
      GROUP BY st.id,pp.user_id,sma.manager_user_id,sm.user_id
      ORDER BY st.last_name,st.first_name
      LIMIT 300
    `);
    return result.rows;
  }

  async financeOverview() {
    const totals = await this.db.execute(sql`
      SELECT
        COALESCE((SELECT SUM(o.total_minor - COALESCE((SELECT SUM(px.refunded_minor) FROM payments px WHERE px.order_id=o.id),0)) FROM orders o WHERE o.status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED')),0)::bigint revenue_minor,
        COALESCE((SELECT SUM(amount_minor) FROM payroll_accruals),0)::bigint teacher_accrual_minor
    `);
    const regular = await this.db.execute(sql`
      SELECT sub.id subject_id,sub.name,COALESCE(SUM(lt.final_total_minor - COALESCE((SELECT SUM(px.refunded_minor) FROM payments px WHERE px.order_id=o.id),0)),0)::bigint revenue_minor,COUNT(*)::int purchases
      FROM lesson_topups lt JOIN orders o ON o.id=lt.order_id AND o.status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED')
      JOIN student_subject_enrollments e ON e.id=lt.enrollment_id JOIN subjects sub ON sub.id=e.subject_id
      GROUP BY sub.id,sub.name ORDER BY revenue_minor DESC
    `);
    const first = await this.db.execute(sql`
      SELECT sub.id subject_id,sub.name,COALESCE(SUM(flo.final_price_minor - COALESCE((SELECT SUM(px.refunded_minor) FROM payments px WHERE px.order_id=o.id),0)),0)::bigint revenue_minor,COUNT(*)::int purchases
      FROM first_lesson_orders flo JOIN orders o ON o.id=flo.order_id AND o.status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED')
      JOIN live_sessions ls ON ls.id=flo.session_id JOIN subjects sub ON sub.id=ls.subject_id
      GROUP BY sub.id,sub.name ORDER BY revenue_minor DESC
    `);
    const courses = await this.db.execute(sql`
      SELECT c.id course_id,c.title,COALESCE(SUM(cp.final_price_minor - COALESCE((SELECT SUM(px.refunded_minor) FROM payments px WHERE px.order_id=o.id),0)),0)::bigint revenue_minor,COUNT(*)::int purchases
      FROM course_purchases cp JOIN orders o ON o.id=cp.order_id AND o.status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED') JOIN courses c ON c.id=cp.course_id
      GROUP BY c.id,c.title ORDER BY revenue_minor DESC
    `);
    const payroll = await this.db.execute(sql`
      SELECT sub.id subject_id,sub.name,COALESCE(SUM(pa.amount_minor),0)::bigint amount_minor
      FROM payroll_accruals pa LEFT JOIN subjects sub ON sub.id=pa.subject_id GROUP BY sub.id,sub.name ORDER BY amount_minor DESC
    `);
    const t=totals.rows[0] as any;
    return {totals:{...t,operatingDifferenceMinor:Number(t.revenue_minor)-Number(t.teacher_accrual_minor)},regular:regular.rows,firstLessons:first.rows,courses:courses.rows,payroll:payroll.rows};
  }

  private async analyticsRange(input: { from?: string; to?: string }) {
    let from = input.from;
    let to = input.to;
    if (!from || !to) {
      const defaultRange = await this.db.execute(sql`
        SELECT to_char(date_trunc('month',now() AT TIME ZONE 'Europe/Kyiv'),'YYYY-MM-DD') AS "from",
               to_char((now() AT TIME ZONE 'Europe/Kyiv')::date,'YYYY-MM-DD') AS "to"
      `);
      const row = defaultRange.rows[0] as { from: string; to: string };
      from = from ?? row.from;
      to = to ?? row.to;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      throw new BadRequestException({ code: "ANALYTICS_DATE_INVALID", message: "Analytics dates must use YYYY-MM-DD" });
    }
    const start = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) {
      throw new BadRequestException({ code: "ANALYTICS_RANGE_INVALID", message: "Analytics date range is invalid" });
    }
    const days = Math.floor((end.getTime()-start.getTime())/86_400_000)+1;
    if (days > 731) throw new BadRequestException({ code: "ANALYTICS_RANGE_TOO_LARGE", message: "Analytics range cannot exceed 731 days" });
    return { from, to, days };
  }

  async analytics(input: { from?: string; to?: string; bucket?: string }) {
    const range = await this.analyticsRange(input);
    const bucket = input.bucket === "month" ? "month" : "day";
    const [summary, regular, first, courses, payroll, learning] = await Promise.all([
      this.db.execute(sql`
        SELECT
          COALESCE((SELECT SUM(o.total_minor - COALESCE((SELECT SUM(px.refunded_minor) FROM payments px WHERE px.order_id=o.id),0)) FROM orders o WHERE o.status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED') AND (o.paid_at AT TIME ZONE 'Europe/Kyiv')::date BETWEEN ${range.from}::date AND ${range.to}::date),0)::bigint AS revenue_minor,
          COALESCE((SELECT SUM(amount_minor) FROM payroll_accruals WHERE earned_for_date BETWEEN ${range.from}::date AND ${range.to}::date),0)::bigint AS teacher_accrual_minor,
          (SELECT COUNT(*)::int FROM orders o WHERE o.status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED') AND (o.paid_at AT TIME ZONE 'Europe/Kyiv')::date BETWEEN ${range.from}::date AND ${range.to}::date) AS paid_orders
      `),
      this.db.execute(sql`
        SELECT sub.id subject_id,sub.name,COALESCE(SUM(lt.final_total_minor - COALESCE((SELECT SUM(px.refunded_minor) FROM payments px WHERE px.order_id=o.id),0)),0)::bigint revenue_minor,COUNT(*)::int purchases
        FROM lesson_topups lt JOIN orders o ON o.id=lt.order_id AND o.status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED')
        JOIN student_subject_enrollments e ON e.id=lt.enrollment_id JOIN subjects sub ON sub.id=e.subject_id
        WHERE (o.paid_at AT TIME ZONE 'Europe/Kyiv')::date BETWEEN ${range.from}::date AND ${range.to}::date
        GROUP BY sub.id,sub.name ORDER BY revenue_minor DESC
      `),
      this.db.execute(sql`
        SELECT sub.id subject_id,sub.name,COALESCE(SUM(flo.final_price_minor - COALESCE((SELECT SUM(px.refunded_minor) FROM payments px WHERE px.order_id=o.id),0)),0)::bigint revenue_minor,COUNT(*)::int purchases
        FROM first_lesson_orders flo JOIN orders o ON o.id=flo.order_id AND o.status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED')
        JOIN live_sessions ls ON ls.id=flo.session_id JOIN subjects sub ON sub.id=ls.subject_id
        WHERE (o.paid_at AT TIME ZONE 'Europe/Kyiv')::date BETWEEN ${range.from}::date AND ${range.to}::date
        GROUP BY sub.id,sub.name ORDER BY revenue_minor DESC
      `),
      this.db.execute(sql`
        SELECT c.id course_id,c.title,COALESCE(SUM(cp.final_price_minor - COALESCE((SELECT SUM(px.refunded_minor) FROM payments px WHERE px.order_id=o.id),0)),0)::bigint revenue_minor,COUNT(*)::int purchases
        FROM course_purchases cp JOIN orders o ON o.id=cp.order_id AND o.status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED') JOIN courses c ON c.id=cp.course_id
        WHERE (o.paid_at AT TIME ZONE 'Europe/Kyiv')::date BETWEEN ${range.from}::date AND ${range.to}::date
        GROUP BY c.id,c.title ORDER BY revenue_minor DESC
      `),
      this.db.execute(sql`
        SELECT sub.id subject_id,sub.name,COALESCE(SUM(pa.amount_minor),0)::bigint amount_minor,COUNT(*)::int accruals
        FROM payroll_accruals pa LEFT JOIN subjects sub ON sub.id=pa.subject_id
        WHERE pa.earned_for_date BETWEEN ${range.from}::date AND ${range.to}::date
        GROUP BY sub.id,sub.name ORDER BY amount_minor DESC
      `),
      this.db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE status='COMPLETED')::int AS conducted,
          COUNT(*) FILTER (WHERE status='COMPLETED' AND session_type='REGULAR')::int AS regular_conducted,
          COUNT(*) FILTER (WHERE status='COMPLETED' AND session_type='FIRST')::int AS first_conducted,
          COUNT(*) FILTER (WHERE status='COMPLETED' AND EXTRACT(EPOCH FROM (ends_at-starts_at))/60=30)::int AS thirty_minute,
          COUNT(*) FILTER (WHERE status='CHARGED_NO_SHOW')::int AS charged_no_show
        FROM live_sessions
        WHERE (starts_at AT TIME ZONE 'Europe/Kyiv')::date BETWEEN ${range.from}::date AND ${range.to}::date
      `),
    ]);

    const trend = bucket === "month"
      ? await this.db.execute(sql`
          WITH r AS (
            SELECT date_trunc('month',o.paid_at AT TIME ZONE 'Europe/Kyiv')::date bucket, SUM(o.total_minor - COALESCE((SELECT SUM(px.refunded_minor) FROM payments px WHERE px.order_id=o.id),0))::bigint revenue_minor
            FROM orders o WHERE o.status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED') AND (o.paid_at AT TIME ZONE 'Europe/Kyiv')::date BETWEEN ${range.from}::date AND ${range.to}::date GROUP BY 1
          ), p AS (
            SELECT date_trunc('month',earned_for_date)::date bucket, SUM(amount_minor)::bigint teacher_accrual_minor
            FROM payroll_accruals WHERE earned_for_date BETWEEN ${range.from}::date AND ${range.to}::date GROUP BY 1
          )
          SELECT COALESCE(r.bucket,p.bucket) AS bucket,COALESCE(r.revenue_minor,0)::bigint revenue_minor,COALESCE(p.teacher_accrual_minor,0)::bigint teacher_accrual_minor
          FROM r FULL OUTER JOIN p USING(bucket) ORDER BY bucket
        `)
      : await this.db.execute(sql`
          WITH r AS (
            SELECT (o.paid_at AT TIME ZONE 'Europe/Kyiv')::date bucket, SUM(o.total_minor - COALESCE((SELECT SUM(px.refunded_minor) FROM payments px WHERE px.order_id=o.id),0))::bigint revenue_minor
            FROM orders o WHERE o.status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED') AND (o.paid_at AT TIME ZONE 'Europe/Kyiv')::date BETWEEN ${range.from}::date AND ${range.to}::date GROUP BY 1
          ), p AS (
            SELECT earned_for_date::date bucket, SUM(amount_minor)::bigint teacher_accrual_minor
            FROM payroll_accruals WHERE earned_for_date BETWEEN ${range.from}::date AND ${range.to}::date GROUP BY 1
          )
          SELECT COALESCE(r.bucket,p.bucket) AS bucket,COALESCE(r.revenue_minor,0)::bigint revenue_minor,COALESCE(p.teacher_accrual_minor,0)::bigint teacher_accrual_minor
          FROM r FULL OUTER JOIN p USING(bucket) ORDER BY bucket
        `);

    const totals = summary.rows[0] as any;
    return {
      range: { ...range, bucket },
      summary: { ...totals, operatingDifferenceMinor: Number(totals.revenue_minor)-Number(totals.teacher_accrual_minor) },
      learning: learning.rows[0],
      trend: trend.rows,
      regular: regular.rows,
      firstLessons: first.rows,
      courses: courses.rows,
      payroll: payroll.rows,
    };
  }


  async payments(limit=100) {
    const result = await this.db.execute(sql`
      SELECT o.id,o.created_at,o.paid_at,o.total_minor,o.currency,o.source,o.status,
        pp.first_name parent_first_name,pp.last_name parent_last_name,
        st.first_name student_first_name,st.last_name student_last_name,
        sub.name subject_name,COALESCE(lt.lesson_units,lci.lesson_units) AS lesson_units,
        p.method,p.status AS payment_status,p.provider,p.provider_status,COALESCE(p.refunded_minor,0)::bigint AS refunded_minor,
        COALESCE((
          SELECT (g.credits_granted - COALESCE((SELECT SUM(a.credits) FROM lesson_credit_allocations a WHERE a.grant_id=g.id),0)) / 2.0
          FROM lesson_credit_grants g
          WHERE g.lesson_topup_id=lt.id AND g.type='PURCHASE'
          LIMIT 1
        ),0)::numeric AS refundable_lesson_units
      FROM orders o
      JOIN families f ON f.id=o.family_id
      JOIN parent_profiles pp ON pp.family_id=f.id
      LEFT JOIN lesson_topups lt ON lt.order_id=o.id
      LEFT JOIN lesson_checkout_intents lci ON lci.order_id=o.id
      LEFT JOIN student_subject_enrollments e ON e.id=COALESCE(lt.enrollment_id,lci.enrollment_id)
      LEFT JOIN students st ON st.id=e.student_id
      LEFT JOIN subjects sub ON sub.id=e.subject_id
      LEFT JOIN LATERAL (SELECT method,status,provider,provider_status,refunded_minor FROM payments p WHERE p.order_id=o.id ORDER BY p.created_at DESC LIMIT 1) p ON true
      ORDER BY o.created_at DESC LIMIT ${Math.min(Math.max(limit,1),500)}
    `);
    return result.rows;
  }

  async paymentReconciliation(limit=100) {
    const result = await this.db.execute(sql`
      SELECT
        e.id,e.provider,e.order_id,e.provider_payment_id,e.provider_status,e.provider_updated_at,
        e.received_at,e.processed_at,e.processing_error,e.reconciled_at,e.reconciled_by,e.reconciliation_note,
        o.status AS order_status,o.total_minor,o.currency,
        p.status AS payment_status,p.refunded_minor,
        pp.first_name AS parent_first_name,pp.last_name AS parent_last_name,
        st.first_name AS student_first_name,st.last_name AS student_last_name
      FROM payment_provider_events e
      LEFT JOIN orders o ON o.id=e.order_id
      LEFT JOIN LATERAL (
        SELECT status,refunded_minor FROM payments p2
        WHERE p2.order_id=e.order_id AND p2.provider=e.provider
        ORDER BY p2.created_at DESC LIMIT 1
      ) p ON true
      LEFT JOIN families f ON f.id=o.family_id
      LEFT JOIN parent_profiles pp ON pp.family_id=f.id
      LEFT JOIN lesson_checkout_intents lci ON lci.order_id=o.id
      LEFT JOIN student_subject_enrollments sse ON sse.id=lci.enrollment_id
      LEFT JOIN students st ON st.id=sse.student_id
      WHERE e.processing_error IS NOT NULL
        AND e.processing_error <> 'STALE_PROVIDER_EVENT'
        AND e.reconciled_at IS NULL
      ORDER BY e.received_at DESC
      LIMIT ${Math.min(Math.max(limit,1),500)}
    `);
    return result.rows;
  }

  async resolvePaymentReconciliation(eventId:string,note:string,actor:AuthUser,requestId?:string) {
    const normalizedNote=note.trim();
    return this.db.transaction(async tx=>{
      const before=await tx.execute(sql`
        SELECT id,provider,order_id,provider_payment_id,provider_status,processing_error,reconciled_at,reconciliation_note
        FROM payment_provider_events
        WHERE id=${eventId}
        FOR UPDATE
      `);
      if(!before.rowCount) throw new NotFoundException({code:"PAYMENT_RECONCILIATION_NOT_FOUND",message:"Payment reconciliation event not found"});
      const row=before.rows[0] as any;
      if(!row.processing_error || row.processing_error==='STALE_PROVIDER_EVENT') {
        throw new BadRequestException({code:"PAYMENT_RECONCILIATION_NOT_REQUIRED",message:"This provider event does not require reconciliation"});
      }
      if(row.reconciled_at) {
        throw new ConflictException({code:"PAYMENT_RECONCILIATION_ALREADY_RESOLVED",message:"Payment reconciliation event is already resolved"});
      }
      const updated=await tx.execute(sql`
        UPDATE payment_provider_events
        SET reconciled_at=now(),reconciled_by=${actor.id},reconciliation_note=${normalizedNote}
        WHERE id=${eventId}
        RETURNING id,provider,order_id,provider_payment_id,provider_status,processing_error,reconciled_at,reconciled_by,reconciliation_note
      `);
      await this.audit.record({actorUserId:actor.id,actorRoleCode:actor.roles[0],action:"RESOLVE_PAYMENT_RECONCILIATION",entityType:"PaymentProviderEvent",entityId:eventId,beforeData:row,afterData:updated.rows[0],requestId},tx as any);
      return updated.rows[0];
    });
  }

  async auditLog(limit=100) {
    const result = await this.db.execute(sql`
      SELECT a.*,u.email actor_email,coalesce(sp.first_name||' '||sp.last_name,tp.first_name||' '||tp.last_name,pp.first_name||' '||pp.last_name) actor_name
      FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id
      LEFT JOIN staff_profiles sp ON sp.user_id=a.actor_user_id
      LEFT JOIN teacher_profiles tp ON tp.user_id=a.actor_user_id
      LEFT JOIN parent_profiles pp ON pp.user_id=a.actor_user_id
      ORDER BY a.created_at DESC LIMIT ${Math.min(Math.max(limit,1),500)}
    `);
    return result.rows;
  }

  async settings() {
    const r=await this.db.execute(sql`
      SELECT key,value,description,category,value_type,unit,min_numeric,max_numeric,is_critical,sort_order,updated_at
      FROM school_settings ORDER BY category,sort_order,key
    `);
    return r.rows;
  }

  private normalizeSettingValue(meta: any, value: unknown) {
    const type = String(meta.value_type ?? "JSON");
    if (type === "INTEGER" || type === "NUMBER") {
      const number = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(number) || (type === "INTEGER" && !Number.isInteger(number))) {
        throw new BadRequestException({ code: "SETTING_VALUE_INVALID", message: `Setting ${meta.key} requires ${type === "INTEGER" ? "an integer" : "a number"}` });
      }
      if (meta.min_numeric != null && number < Number(meta.min_numeric)) throw new BadRequestException({ code:"SETTING_VALUE_TOO_SMALL",message:`Setting ${meta.key} must be at least ${meta.min_numeric}` });
      if (meta.max_numeric != null && number > Number(meta.max_numeric)) throw new BadRequestException({ code:"SETTING_VALUE_TOO_LARGE",message:`Setting ${meta.key} must be at most ${meta.max_numeric}` });
      return number;
    }
    if (type === "STRING") return String(value ?? "").trim();
    if (type === "MONTH_DAY") {
      const text=String(value ?? "");
      const match=/^(\d{2})-(\d{2})$/.exec(text);
      if(!match) throw new BadRequestException({code:"SETTING_MONTH_DAY_INVALID",message:"Month-day value must use MM-DD"});
      const month=Number(match[1]),day=Number(match[2]);
      const date=new Date(Date.UTC(2000,month-1,day));
      if(date.getUTCMonth()!==month-1||date.getUTCDate()!==day) throw new BadRequestException({code:"SETTING_MONTH_DAY_INVALID",message:"Month-day value is invalid"});
      return text;
    }
    if (type === "DATE") {
      const text=String(value ?? "");
      if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||!Number.isFinite(new Date(`${text}T00:00:00Z`).getTime())) throw new BadRequestException({code:"SETTING_DATE_INVALID",message:"Date value must use YYYY-MM-DD"});
      return text;
    }
    if (type === "TIMEZONE") {
      const text=String(value ?? "").trim();
      try { new Intl.DateTimeFormat("en-US",{timeZone:text}).format(new Date()); } catch { throw new BadRequestException({code:"SETTING_TIMEZONE_INVALID",message:"Timezone must be a valid IANA timezone"}); }
      return text;
    }
    return value;
  }

  async settingHistory(key:string,limit=50) {
    const exists=await this.db.execute(sql`SELECT 1 FROM school_settings WHERE key=${key}`);
    if(!exists.rowCount) throw new NotFoundException({code:"SETTING_NOT_FOUND",message:"Setting not found"});
    const result=await this.db.execute(sql`
      SELECT a.id,a.created_at,a.before_data,a.after_data,a.actor_role_code,u.email AS actor_email,
        COALESCE(sp.first_name||' '||sp.last_name,tp.first_name||' '||tp.last_name,pp.first_name||' '||pp.last_name) AS actor_name
      FROM audit_logs a
      LEFT JOIN users u ON u.id=a.actor_user_id
      LEFT JOIN staff_profiles sp ON sp.user_id=a.actor_user_id
      LEFT JOIN teacher_profiles tp ON tp.user_id=a.actor_user_id
      LEFT JOIN parent_profiles pp ON pp.user_id=a.actor_user_id
      WHERE a.action='UPDATE_SCHOOL_SETTING' AND a.entity_type='SchoolSetting'
        AND (a.after_data->>'key'=${key} OR a.before_data->>'key'=${key})
      ORDER BY a.created_at DESC LIMIT ${Math.min(Math.max(limit,1),200)}
    `);
    return result.rows;
  }

  async updateSetting(key:string,value:unknown,actor:AuthUser,requestId?:string) {
    return this.db.transaction(async tx=>{
      const before=await tx.execute(sql`SELECT * FROM school_settings WHERE key=${key} FOR UPDATE`);
      if(!before.rowCount) throw new NotFoundException({code:"SETTING_NOT_FOUND",message:"Setting not found"});
      const meta=before.rows[0] as any;
      const normalized=this.normalizeSettingValue(meta,value);
      const updated=await tx.execute(sql`
        UPDATE school_settings SET value=${JSON.stringify(normalized)}::jsonb,updated_by=${actor.id},updated_at=now()
        WHERE key=${key}
        RETURNING key,value,description,category,value_type,unit,min_numeric,max_numeric,is_critical,sort_order,updated_at
      `);
      await this.audit.record({actorUserId:actor.id,actorRoleCode:actor.roles[0],action:"UPDATE_SCHOOL_SETTING",entityType:"SchoolSetting",beforeData:{key,value:meta.value},afterData:{key,value:normalized},requestId},tx as any);
      return updated.rows[0];
    });
  }


  async createLead(dto:CreateLeadDto,actor?:AuthUser) {
    const r=await this.db.execute(sql`
      INSERT INTO leads(source,parent_first_name,parent_last_name,student_first_name,student_last_name,phone,email,telegram,subject_id,grade_level,desired_schedule,learning_goal,teacher_preference,create_student_account,primary_manager_id,created_by)
      VALUES(${dto.source},${dto.parentFirstName??null},${dto.parentLastName??null},${dto.studentFirstName??null},${dto.studentLastName??null},${dto.phone},${dto.email??null},${dto.telegram??null},${dto.subjectId??null},${dto.gradeLevel??null},${dto.desiredSchedule??null},${dto.learningGoal??null},${dto.teacherPreference??null},${dto.createStudentAccount??null},${dto.primaryManagerId??null},${actor?.id??null}) RETURNING *
    `); return r.rows[0];
  }
  async leads(status?:string) { const r=await this.db.execute(sql`SELECT l.*,s.name subject_name,sp.first_name manager_first_name,sp.last_name manager_last_name,c.title source_course_title,topic.name source_topic_name,ta.percentage source_test_percentage FROM leads l LEFT JOIN subjects s ON s.id=l.subject_id LEFT JOIN staff_profiles sp ON sp.user_id=l.primary_manager_id LEFT JOIN courses c ON c.id=l.source_course_id LEFT JOIN subject_topics topic ON topic.id=l.source_topic_id LEFT JOIN test_attempts ta ON ta.id=l.source_test_attempt_id WHERE (${status??null}::text IS NULL OR l.status::text=${status??null}) ORDER BY l.created_at DESC LIMIT 300`); return r.rows; }
  async updateLead(id: string, dto: UpdateLeadDto, actor: AuthUser, requestId?: string) {
    return this.db.transaction(async (tx) => {
      const locked = await tx.execute(sql`SELECT * FROM leads WHERE id=${id} FOR UPDATE`);
      if (!locked.rowCount) throw new NotFoundException({ code: "LEAD_NOT_FOUND", message: "Lead not found" });
      const before = locked.rows[0] as any;
      const studentId = dto.convertedStudentId ?? before.converted_student_id;
      const familyId = dto.convertedFamilyId ?? before.converted_family_id;
      if (studentId) {
        const student = await tx.execute(sql`SELECT family_id FROM students WHERE id=${studentId} AND archived_at IS NULL`);
        if (!student.rowCount || (familyId && (student.rows[0] as any).family_id !== familyId)) {
          throw new BadRequestException({ code: "LEAD_STUDENT_MISMATCH", message: "Student must belong to the linked active family" });
        }
      }
      if (dto.status === "LOST" && !dto.refusalReason?.trim()) {
        throw new BadRequestException({ code: "LEAD_REFUSAL_REASON_REQUIRED", message: "Enter the reason for refusal" });
      }
      if (dto.status === "FIRST_LESSON") {
        const sessionId = dto.firstLessonSessionId ?? before.first_lesson_session_id;
        if (!studentId || !sessionId) throw new BadRequestException({ code: "LEAD_FIRST_LESSON_REQUIRED", message: "Link a student and schedule the first lesson" });
        const session = await tx.execute(sql`
          SELECT 1 FROM live_sessions WHERE id=${sessionId} AND student_id=${studentId}
            AND session_type='FIRST' AND status IN ('SCHEDULED','COMPLETED') LIMIT 1
        `);
        if (!session.rowCount) throw new BadRequestException({ code: "LEAD_FIRST_LESSON_MISMATCH", message: "The first lesson does not belong to this student" });
      }
      if (dto.status === "CONVERTED") {
        const enrollmentId = dto.convertedEnrollmentId ?? before.converted_enrollment_id;
        if (!studentId || !enrollmentId) throw new BadRequestException({ code: "LEAD_REGULAR_SCHEDULE_REQUIRED", message: "Link a student and configure regular lessons" });
        const enrollment = await tx.execute(sql`
          SELECT 1 FROM student_subject_enrollments e
          WHERE e.id=${enrollmentId} AND e.student_id=${studentId} AND e.status='ACTIVE'
            AND EXISTS(SELECT 1 FROM teacher_assignments ta WHERE ta.enrollment_id=e.id AND ta.ended_at IS NULL)
            AND EXISTS(SELECT 1 FROM regular_schedule_versions v WHERE v.enrollment_id=e.id)
          LIMIT 1
        `);
        if (!enrollment.rowCount) throw new BadRequestException({ code: "LEAD_REGULAR_SCHEDULE_REQUIRED", message: "Assign a teacher and configure regular lessons first" });
      }
      const result = await tx.execute(sql`
        UPDATE leads SET status=COALESCE(${dto.status ?? null}::lead_status,status),
          primary_manager_id=COALESCE(${dto.primaryManagerId ?? null}::uuid,primary_manager_id),
          converted_family_id=COALESCE(${dto.convertedFamilyId ?? null}::uuid,converted_family_id),
          converted_student_id=COALESCE(${dto.convertedStudentId ?? null}::uuid,converted_student_id),
          first_lesson_session_id=COALESCE(${dto.firstLessonSessionId ?? null}::uuid,first_lesson_session_id),
          converted_enrollment_id=COALESCE(${dto.convertedEnrollmentId ?? null}::uuid,converted_enrollment_id),
          refusal_reason=CASE WHEN ${dto.status ?? null}::lead_status='LOST' THEN ${dto.refusalReason?.trim() ?? null}
            WHEN ${dto.status ?? null}::lead_status IS NOT NULL THEN NULL ELSE refusal_reason END,
          updated_at=now() WHERE id=${id} RETURNING *
      `);
      await this.audit.record({
        actorUserId: actor.id, actorRoleCode: actor.roles[0], action: "UPDATE_LEAD",
        entityType: "Lead", entityId: id, beforeData: before, afterData: result.rows[0], requestId,
      }, tx as any);
      return result.rows[0];
    });
  }

  async createTeacherApplication(dto:CreateTeacherApplicationDto) {
    return this.db.transaction(async tx=>{const r=await tx.execute(sql`INSERT INTO teacher_applications(first_name,last_name,email,phone,telegram,education,experience,grades_worked,exam_experience,approximate_hours) VALUES(${dto.firstName},${dto.lastName},${dto.email},${dto.phone},${dto.telegram??null},${dto.education??null},${dto.experience??null},${dto.gradesWorked??null},${dto.examExperience??null},${dto.approximateHours??null}) RETURNING *`); const app=r.rows[0] as any; for(const subjectId of dto.subjectIds??[]) await tx.execute(sql`INSERT INTO teacher_application_subjects(application_id,subject_id) VALUES(${app.id},${subjectId}) ON CONFLICT DO NOTHING`); return app;});
  }
  async teacherApplications(status?:string){const r=await this.db.execute(sql`SELECT a.*,COALESCE(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name)) FILTER(WHERE s.id IS NOT NULL),'[]'::jsonb) subjects FROM teacher_applications a LEFT JOIN teacher_application_subjects tas ON tas.application_id=a.id LEFT JOIN subjects s ON s.id=tas.subject_id WHERE (${status??null}::text IS NULL OR a.status::text=${status??null}) GROUP BY a.id ORDER BY a.created_at DESC`);return r.rows;}
  async reviewTeacherApplication(id:string,status:"APPROVED"|"REJECTED",actor:AuthUser,requestId?:string,comment?:string){
    return this.db.transaction(async tx=>{
      const locked=await tx.execute(sql`SELECT * FROM teacher_applications WHERE id=${id} FOR UPDATE`);
      if(!locked.rowCount) throw new NotFoundException({code:"TEACHER_APPLICATION_NOT_FOUND",message:"Teacher application not found"});
      const app=locked.rows[0] as any;
      if(app.status==='APPROVED') throw new ConflictException({code:"TEACHER_APPLICATION_ALREADY_APPROVED",message:"Application is already approved"});
      if(status==='REJECTED'){
        const r=await tx.execute(sql`UPDATE teacher_applications SET status='REJECTED',reviewed_by=${actor.id},reviewed_at=now(),updated_at=now() WHERE id=${id} RETURNING *`);
        await this.audit.record({actorUserId:actor.id,actorRoleCode:actor.roles[0],action:"REJECT_TEACHER_APPLICATION",entityType:"TeacherApplication",entityId:id,beforeData:app,afterData:{...(r.rows[0] as any),comment},requestId},tx as any);return r.rows[0];
      }
      const existing=await tx.execute(sql`SELECT id FROM users WHERE email=${app.email}`);if(existing.rowCount)throw new ConflictException({code:"EMAIL_ALREADY_IN_USE",message:"Applicant email is already in use"});
      const role=await tx.execute(sql`SELECT id FROM roles WHERE code='TEACHER' LIMIT 1`);if(!role.rowCount)throw new Error('TEACHER role not seeded');
      const u=await tx.execute(sql`INSERT INTO users(email,status) VALUES(${app.email},'PENDING') RETURNING id,email`);const user=u.rows[0] as any;
      await tx.execute(sql`INSERT INTO user_roles(user_id,role_id,assigned_by) VALUES(${user.id},${(role.rows[0] as any).id},${actor.id})`);
      await tx.execute(sql`INSERT INTO teacher_profiles(user_id,first_name,last_name,phone,status,started_at) VALUES(${user.id},${app.first_name},${app.last_name},${app.phone},'INVITED',CURRENT_DATE)`);
      await tx.execute(sql`INSERT INTO teacher_subjects(teacher_id,subject_id,is_active) SELECT ${user.id},subject_id,true FROM teacher_application_subjects WHERE application_id=${id} ON CONFLICT(teacher_id,subject_id) DO UPDATE SET is_active=true`);
      await tx.execute(sql`UPDATE teacher_applications SET status='APPROVED',reviewed_by=${actor.id},reviewed_at=now(),updated_at=now() WHERE id=${id}`);
      const token=randomBytes(32).toString('base64url');const tokenHash=createHash('sha256').update(token).digest('hex');
      await tx.execute(sql`INSERT INTO user_invitations(user_id,token_hash,expires_at,created_by) VALUES(${user.id},${tokenHash},now()+interval '7 days',${actor.id})`);
      await this.outbox.publish({eventType:'EMAIL_INVITATION',aggregateType:'User',aggregateId:user.id,payload:{email:app.email,token}},tx as any);
      await this.audit.record({actorUserId:actor.id,actorRoleCode:actor.roles[0],action:"APPROVE_TEACHER_APPLICATION",entityType:"TeacherApplication",entityId:id,beforeData:app,afterData:{status:'APPROVED',teacherUserId:user.id,comment},requestId},tx as any);
      return {applicationId:id,status:'APPROVED',teacherUserId:user.id,email:user.email};
    });
  }
}
