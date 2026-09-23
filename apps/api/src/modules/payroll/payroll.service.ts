import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Database } from "@school/db";
import { sql } from "drizzle-orm";
import { DATABASE } from "../../common/database/database.constants";
import type { AuthUser } from "../auth/types";
import { AuditService } from "../audit/audit.service";
import type { BulkConfirmPayoutsDto } from "./dto/bulk-confirm-payouts.dto";
import type { PayoutDetailsDto } from "./dto/payout-details.dto";
import { kyivDateIso, payrollWindowsAround } from "./payroll-periods";

type SqlExecutor = any;

type PayrollSettings = {
  anchorDate: string;
  periodDays: number;
  payoutWindowDays: number;
};

type PayoutRow = {
  id: string;
  payroll_period_id: string;
  teacher_id: string;
  amount_snapshot_minor: number | string;
  status: "PENDING" | "READY" | "PAID";
  payout_destination_snapshot_encrypted: string | null;
  payout_destination_masked: string | null;
};

const TYPE_LABELS: Record<string, string> = {
  REGULAR_60: "Регулярні 60 хв",
  REGULAR_30: "Регулярні 30 хв",
  FIRST_LESSON: "Перші уроки",
  PAID_STUDENT_NO_SHOW: "Оплачений no-show",
  COMPENSATION: "Компенсаційні",
  ADJUSTMENT: "Коригування",
};

@Injectable()
export class PayrollService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  private key() {
    return createHash("sha256")
      .update(this.config.get<string>("APP_ENCRYPTION_KEY", "dev-only-change-me"))
      .digest();
  }

  private encrypt(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString("base64url");
  }

  private decrypt(value: string) {
    const data = Buffer.from(value, "base64url");
    const iv = data.subarray(0, 12);
    const tag = data.subarray(12, 28);
    const payload = data.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", this.key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(payload), decipher.final()]).toString("utf8");
  }

  private jsonScalar(value: unknown) {
    if (value === null || value === undefined) return undefined;
    if (typeof value === "string" || typeof value === "number") return value;
    return value;
  }

  private async settings(): Promise<PayrollSettings> {
    const result = await this.db.execute(sql`
      SELECT key, value
      FROM school_settings
      WHERE key IN ('payroll_anchor_date', 'payroll_period_days', 'payroll_payout_window_days')
    `);
    const map = new Map((result.rows as any[]).map((row) => [row.key, this.jsonScalar(row.value)]));
    return {
      anchorDate: String(map.get("payroll_anchor_date") ?? "2026-09-07"),
      periodDays: Number(map.get("payroll_period_days") ?? 14),
      payoutWindowDays: Number(map.get("payroll_payout_window_days") ?? 3),
    };
  }

  async ensurePeriods() {
    const settings = await this.settings();
    const windows = payrollWindowsAround(
      settings.anchorDate,
      kyivDateIso(),
      settings.periodDays,
      settings.payoutWindowDays,
      2,
      4,
    );

    for (const window of windows) {
      await this.db.execute(sql`
        INSERT INTO payroll_periods(period_start, period_end, payout_window_start, payout_window_end)
        VALUES(${window.periodStart}, ${window.periodEnd}, ${window.payoutWindowStart}, ${window.payoutWindowEnd})
        ON CONFLICT(period_start, period_end) DO NOTHING
      `);
    }
    return this.periods();
  }

  async periods() {
    const result = await this.db.execute(sql`
      SELECT
        pp.*,
        COUNT(p.id)::int AS payout_count,
        COUNT(p.id) FILTER (WHERE p.status = 'PAID')::int AS paid_count,
        COUNT(p.id) FILTER (WHERE p.status = 'PENDING')::int AS pending_count,
        COUNT(p.id) FILTER (WHERE p.payout_destination_masked IS NULL)::int AS missing_details_count,
        COALESCE(SUM(p.amount_snapshot_minor), 0)::bigint AS total_minor,
        COALESCE((
          SELECT SUM(pa.amount_minor)::bigint
          FROM teacher_payouts p2
          JOIN teacher_payout_items pi ON pi.payout_id = p2.id
          JOIN payroll_accruals pa ON pa.id = pi.accrual_id
          WHERE p2.payroll_period_id = pp.id
            AND pa.earned_for_date < pp.period_start
        ), 0)::bigint AS adjustment_minor,
        CASE
          WHEN pp.calculated_at IS NULL OR pp.status = 'PAID' THEN 0
          ELSE (
            SELECT COUNT(*)::int
            FROM payroll_accruals a
            WHERE a.earned_for_date <= pp.period_end
              AND a.created_at > pp.calculated_at
              AND NOT EXISTS (
                SELECT 1 FROM payroll_accrual_settlements s WHERE s.accrual_id = a.id
              )
          )
        END AS pending_recalc_count
      FROM payroll_periods pp
      LEFT JOIN teacher_payouts p ON p.payroll_period_id = pp.id
      GROUP BY pp.id
      ORDER BY pp.period_start DESC
      LIMIT 30
    `);
    return result.rows;
  }

  private async refreshPeriodStatus(executor: SqlExecutor, periodId: string) {
    const counts = await executor.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'PAID')::int AS paid
      FROM teacher_payouts
      WHERE payroll_period_id = ${periodId}
    `);
    const row = counts.rows[0] as any;
    const total = Number(row.total ?? 0);
    const paid = Number(row.paid ?? 0);
    const status = total > 0 && paid === total ? "PAID" : paid > 0 ? "PAYING" : "CALCULATED";
    await executor.execute(sql`
      UPDATE payroll_periods
      SET status = ${status}::payroll_period_status,
          closed_at = CASE WHEN ${status} = 'PAID' THEN COALESCE(closed_at, now()) ELSE NULL END
      WHERE id = ${periodId}
    `);
    return status;
  }

  async calculate(periodId: string, actor: AuthUser, requestId?: string) {
    return this.db.transaction(async (tx) => {
      const periodResult = await tx.execute(sql`SELECT * FROM payroll_periods WHERE id = ${periodId} FOR UPDATE`);
      if (!periodResult.rowCount) {
        throw new NotFoundException({ code: "PAYROLL_PERIOD_NOT_FOUND", message: "Payroll period not found" });
      }
      const period = periodResult.rows[0] as any;
      if (period.status === "PAID") {
        throw new ConflictException({ code: "PAYROLL_PERIOD_PAID", message: "Paid period is immutable" });
      }

      // Historical late accruals are intentionally swept into the next non-closed period.
      // A teacher whose payout in this target period is already PAID is excluded, so a late
      // accrual can never mutate that frozen payout and remains available for the next period.
      await tx.execute(sql`
        INSERT INTO payroll_accrual_settlements(accrual_id, payroll_period_id)
        SELECT a.id, ${periodId}
        FROM payroll_accruals a
        WHERE a.earned_for_date <= ${period.period_end}
          AND (
            a.earned_for_date >= ${period.period_start}
            OR NOT EXISTS (
              SELECT 1
              FROM payroll_periods prior
              WHERE a.earned_for_date BETWEEN prior.period_start AND prior.period_end
                AND prior.id <> ${periodId}
                AND prior.status <> 'PAID'
            )
          )
          AND NOT EXISTS (
            SELECT 1 FROM payroll_accrual_settlements s WHERE s.accrual_id = a.id
          )
          AND NOT EXISTS (
            SELECT 1
            FROM teacher_payouts p
            WHERE p.payroll_period_id = ${periodId}
              AND p.teacher_id = a.teacher_id
              AND p.status = 'PAID'
          )
        ON CONFLICT DO NOTHING
      `);

      const teachers = await tx.execute(sql`
        SELECT a.teacher_id, COALESCE(SUM(a.amount_minor), 0)::bigint AS amount_minor
        FROM payroll_accruals a
        JOIN payroll_accrual_settlements s ON s.accrual_id = a.id
        WHERE s.payroll_period_id = ${periodId}
        GROUP BY a.teacher_id
      `);

      for (const teacher of teachers.rows as any[]) {
        const existing = await tx.execute(sql`
          SELECT id, status
          FROM teacher_payouts
          WHERE payroll_period_id = ${periodId} AND teacher_id = ${teacher.teacher_id}
          FOR UPDATE
        `);
        if (existing.rowCount && (existing.rows[0] as any).status === "PAID") continue;

        const details = await tx.execute(sql`
          SELECT details_encrypted, masked_display
          FROM teacher_payout_details
          WHERE teacher_id = ${teacher.teacher_id} AND is_active = true
          ORDER BY created_at DESC
          LIMIT 1
        `);
        const detail = details.rows[0] as any | undefined;
        const payoutStatus = detail ? "READY" : "PENDING";

        const payout = await tx.execute(sql`
          INSERT INTO teacher_payouts(
            payroll_period_id,
            teacher_id,
            amount_snapshot_minor,
            payout_destination_snapshot_encrypted,
            payout_destination_masked,
            status
          )
          VALUES(
            ${periodId},
            ${teacher.teacher_id},
            ${teacher.amount_minor},
            ${detail?.details_encrypted ?? null},
            ${detail?.masked_display ?? null},
            ${payoutStatus}::teacher_payout_status
          )
          ON CONFLICT(payroll_period_id, teacher_id) DO UPDATE SET
            amount_snapshot_minor = EXCLUDED.amount_snapshot_minor,
            payout_destination_snapshot_encrypted = EXCLUDED.payout_destination_snapshot_encrypted,
            payout_destination_masked = EXCLUDED.payout_destination_masked,
            status = EXCLUDED.status
          RETURNING id, status
        `);
        const payoutId = (payout.rows[0] as any).id as string;

        await tx.execute(sql`
          INSERT INTO teacher_payout_items(payout_id, accrual_id)
          SELECT ${payoutId}, a.id
          FROM payroll_accruals a
          JOIN payroll_accrual_settlements s ON s.accrual_id = a.id
          WHERE s.payroll_period_id = ${periodId}
            AND a.teacher_id = ${teacher.teacher_id}
          ON CONFLICT(accrual_id) DO NOTHING
        `);
      }

      await tx.execute(sql`UPDATE payroll_periods SET calculated_at = now() WHERE id = ${periodId}`);
      const status = await this.refreshPeriodStatus(tx as any, periodId);
      await this.audit.record(
        {
          actorUserId: actor.id,
          actorRoleCode: actor.roles[0],
          action: "CALCULATE_PAYROLL_PERIOD",
          entityType: "PayrollPeriod",
          entityId: periodId,
          afterData: { teacherCount: teachers.rowCount, status },
          requestId,
        },
        tx as any,
      );
      return this.periodDetail(periodId, undefined, undefined, tx as any);
    });
  }

  async periodDetail(periodId: string, status?: string, query?: string, executor: SqlExecutor = this.db) {
    const result = await executor.execute(sql`
      SELECT
        p.id,
        p.teacher_id,
        p.amount_snapshot_minor,
        p.currency,
        p.payout_destination_masked,
        p.status,
        p.paid_at,
        p.confirmed_by,
        pp.period_start,
        pp.period_end,
        pp.payout_window_start,
        pp.payout_window_end,
        pp.status AS period_status,
        tp.first_name,
        tp.last_name,
        (SELECT COUNT(*)::int FROM teacher_payout_items i WHERE i.payout_id = p.id) AS item_count,
        COALESCE((
          SELECT SUM(a.amount_minor)::bigint
          FROM teacher_payout_items i
          JOIN payroll_accruals a ON a.id = i.accrual_id
          WHERE i.payout_id = p.id AND a.earned_for_date < pp.period_start
        ), 0)::bigint AS adjustment_minor,
        (p.payout_destination_masked IS NULL) AS missing_details
      FROM teacher_payouts p
      JOIN payroll_periods pp ON pp.id = p.payroll_period_id
      JOIN teacher_profiles tp ON tp.user_id = p.teacher_id
      WHERE p.payroll_period_id = ${periodId}
        AND (${status ?? null}::text IS NULL OR p.status::text = ${status ?? null})
        AND (
          ${query ?? null}::text IS NULL
          OR concat_ws(' ', tp.last_name, tp.first_name) ILIKE ('%' || ${query ?? null} || '%')
        )
      ORDER BY
        CASE p.status WHEN 'PENDING' THEN 0 WHEN 'READY' THEN 1 ELSE 2 END,
        tp.last_name,
        tp.first_name
    `);
    return result.rows;
  }

  private breakdown(items: any[], periodStart: string) {
    const groups: Record<string, { label: string; count: number; amountMinor: number }> = {
      REGULAR_60: { label: TYPE_LABELS.REGULAR_60, count: 0, amountMinor: 0 },
      REGULAR_30: { label: TYPE_LABELS.REGULAR_30, count: 0, amountMinor: 0 },
      FIRST_LESSON: { label: TYPE_LABELS.FIRST_LESSON, count: 0, amountMinor: 0 },
      PAID_STUDENT_NO_SHOW: { label: TYPE_LABELS.PAID_STUDENT_NO_SHOW, count: 0, amountMinor: 0 },
      COMPENSATION: { label: TYPE_LABELS.COMPENSATION, count: 0, amountMinor: 0 },
      ADJUSTMENT: { label: TYPE_LABELS.ADJUSTMENT, count: 0, amountMinor: 0 },
    };

    for (const item of items) {
      const isLateAdjustment = String(item.earned_for_date) < periodStart;
      const key = item.type === "ADJUSTMENT" || isLateAdjustment ? "ADJUSTMENT" : item.type;
      const group = groups[key] ?? groups.ADJUSTMENT;
      group.count += 1;
      group.amountMinor += Number(item.amount_minor ?? 0);
    }
    return Object.entries(groups).map(([code, value]) => ({ code, ...value }));
  }

  async payoutDetail(id: string, actor: AuthUser) {
    const result = await this.db.execute(sql`
      SELECT p.*, pp.period_start, pp.period_end, pp.payout_window_start, pp.payout_window_end,
             tp.first_name, tp.last_name
      FROM teacher_payouts p
      JOIN payroll_periods pp ON pp.id = p.payroll_period_id
      JOIN teacher_profiles tp ON tp.user_id = p.teacher_id
      WHERE p.id = ${id}
    `);
    if (!result.rowCount) {
      throw new NotFoundException({ code: "PAYOUT_NOT_FOUND", message: "Payout not found" });
    }
    const payout = result.rows[0] as any;
    if (actor.roles.includes("TEACHER") && payout.teacher_id !== actor.id) {
      throw new ForbiddenException({ code: "PAYOUT_SCOPE_DENIED", message: "You may view only your own payouts" });
    }

    const itemsResult = await this.db.execute(sql`
      SELECT
        a.id,
        a.earned_for_date,
        a.type,
        a.amount_minor,
        a.rate_60_snapshot_minor,
        a.reason,
        a.session_id,
        s.name AS subject_name,
        st.first_name AS student_first_name,
        st.last_name AS student_last_name
      FROM teacher_payout_items i
      JOIN payroll_accruals a ON a.id = i.accrual_id
      LEFT JOIN subjects s ON s.id = a.subject_id
      LEFT JOIN live_sessions ls ON ls.id = a.session_id
      LEFT JOIN students st ON st.id = ls.student_id
      WHERE i.payout_id = ${id}
      ORDER BY a.earned_for_date, a.created_at
    `);
    const items = (itemsResult.rows as any[]).map((item) => ({
      ...item,
      isAdjustment: String(item.earned_for_date) < String(payout.period_start) || item.type === "ADJUSTMENT",
    }));

    let fullDestination: string | undefined;
    if ((actor.roles.includes("ADMIN") || actor.roles.includes("FINANCIER")) && payout.payout_destination_snapshot_encrypted) {
      try {
        fullDestination = this.decrypt(payout.payout_destination_snapshot_encrypted);
      } catch {
        fullDestination = undefined;
      }
    }

    return {
      payout: {
        ...payout,
        payout_destination_snapshot_encrypted: undefined,
        fullDestination,
      },
      breakdown: this.breakdown(items, String(payout.period_start)),
      items,
    };
  }

  private async confirmPayoutInTx(tx: any, id: string, actor: AuthUser, requestId?: string) {
    const result = await tx.execute(sql`SELECT * FROM teacher_payouts WHERE id = ${id} FOR UPDATE`);
    if (!result.rowCount) {
      throw new NotFoundException({ code: "PAYOUT_NOT_FOUND", message: "Payout not found" });
    }
    const payout = result.rows[0] as PayoutRow;
    if (payout.status === "PAID") return payout;
    if (!payout.payout_destination_snapshot_encrypted || !payout.payout_destination_masked) {
      throw new ConflictException({
        code: "PAYOUT_DETAILS_REQUIRED",
        message: "Teacher payout details are required before confirmation",
      });
    }
    if (payout.status !== "READY") {
      throw new ConflictException({ code: "PAYOUT_NOT_READY", message: "Payout is not ready for confirmation" });
    }

    const updated = await tx.execute(sql`
      UPDATE teacher_payouts
      SET status = 'PAID', paid_at = now(), confirmed_by = ${actor.id}
      WHERE id = ${id}
      RETURNING *
    `);
    await this.audit.record(
      {
        actorUserId: actor.id,
        actorRoleCode: actor.roles[0],
        action: "CONFIRM_TEACHER_PAYOUT",
        entityType: "TeacherPayout",
        entityId: id,
        beforeData: { status: payout.status },
        afterData: { status: "PAID", amountMinor: payout.amount_snapshot_minor },
        requestId,
      },
      tx,
    );
    return updated.rows[0] as any;
  }

  async confirm(id: string, actor: AuthUser, requestId?: string) {
    return this.db.transaction(async (tx) => {
      const payout = await this.confirmPayoutInTx(tx, id, actor, requestId);
      await this.refreshPeriodStatus(tx as any, (payout as any).payroll_period_id);
      return payout;
    });
  }

  async bulkConfirm(dto: BulkConfirmPayoutsDto, actor: AuthUser, requestId?: string) {
    return this.db.transaction(async (tx) => {
      const confirmed: any[] = [];
      const periodIds = new Set<string>();
      for (const payoutId of [...new Set(dto.payoutIds)]) {
        const payout = await this.confirmPayoutInTx(tx, payoutId, actor, requestId);
        confirmed.push(payout);
        periodIds.add((payout as any).payroll_period_id);
      }
      for (const periodId of periodIds) await this.refreshPeriodStatus(tx as any, periodId);
      await this.audit.record(
        {
          actorUserId: actor.id,
          actorRoleCode: actor.roles[0],
          action: "BULK_CONFIRM_TEACHER_PAYOUTS",
          entityType: "TeacherPayoutBatch",
          afterData: { payoutIds: confirmed.map((p) => p.id), count: confirmed.length },
          requestId,
        },
        tx as any,
      );
      return { confirmedCount: confirmed.length, payouts: confirmed };
    });
  }

  private async teacherIdForActor(actor: AuthUser) {
    if (!actor.roles.includes("TEACHER")) {
      throw new ForbiddenException({ code: "TEACHER_ONLY", message: "Teacher profile required" });
    }
    const result = await this.db.execute(sql`SELECT user_id FROM teacher_profiles WHERE user_id = ${actor.id}`);
    if (!result.rowCount) {
      throw new NotFoundException({ code: "TEACHER_NOT_FOUND", message: "Teacher profile not found" });
    }
    return actor.id;
  }

  async statement(actor: AuthUser, teacherId?: string, from?: string, to?: string) {
    const id = teacherId ?? (await this.teacherIdForActor(actor));
    if (actor.roles.includes("TEACHER") && id !== actor.id) throw new ForbiddenException();
    const result = await this.db.execute(sql`
      SELECT a.*, s.name AS subject_name, st.first_name AS student_first_name, st.last_name AS student_last_name
      FROM payroll_accruals a
      LEFT JOIN subjects s ON s.id = a.subject_id
      LEFT JOIN live_sessions ls ON ls.id = a.session_id
      LEFT JOIN students st ON st.id = ls.student_id
      WHERE a.teacher_id = ${id}
        AND (${from ?? null}::date IS NULL OR a.earned_for_date >= ${from ?? null}::date)
        AND (${to ?? null}::date IS NULL OR a.earned_for_date <= ${to ?? null}::date)
      ORDER BY a.earned_for_date DESC, a.created_at DESC
    `);
    return {
      teacherId: id,
      totalMinor: (result.rows as any[]).reduce((sum, item) => sum + Number(item.amount_minor), 0),
      items: result.rows,
    };
  }

  async teacherPayouts(actor: AuthUser) {
    const id = await this.teacherIdForActor(actor);
    await this.ensurePeriods();
    const today = kyivDateIso();
    const currentPeriodResult = await this.db.execute(sql`
      SELECT * FROM payroll_periods
      WHERE ${today}::date BETWEEN period_start AND period_end
      ORDER BY period_start DESC
      LIMIT 1
    `);
    const currentPeriod = currentPeriodResult.rows[0] as any | undefined;

    const current = currentPeriod
      ? await this.db.execute(sql`
          SELECT COALESCE(SUM(amount_minor), 0)::bigint AS amount_minor
          FROM payroll_accruals a
          WHERE a.teacher_id = ${id}
            AND a.earned_for_date BETWEEN ${currentPeriod.period_start} AND ${currentPeriod.period_end}
            AND NOT EXISTS (SELECT 1 FROM payroll_accrual_settlements s WHERE s.accrual_id = a.id)
        `)
      : { rows: [{ amount_minor: 0 }] } as any;

    const adjustments = currentPeriod
      ? await this.db.execute(sql`
          SELECT COALESCE(SUM(amount_minor), 0)::bigint AS amount_minor
          FROM payroll_accruals a
          WHERE a.teacher_id = ${id}
            AND a.earned_for_date < ${currentPeriod.period_start}
            AND NOT EXISTS (SELECT 1 FROM payroll_accrual_settlements s WHERE s.accrual_id = a.id)
        `)
      : { rows: [{ amount_minor: 0 }] } as any;

    const payouts = await this.db.execute(sql`
      SELECT p.id, p.amount_snapshot_minor, p.currency, p.status, p.paid_at,
             pp.period_start, pp.period_end, pp.payout_window_start, pp.payout_window_end
      FROM teacher_payouts p
      JOIN payroll_periods pp ON pp.id = p.payroll_period_id
      WHERE p.teacher_id = ${id}
      ORDER BY pp.period_start DESC
    `);
    const currentPeriodAccruedMinor = Number((current.rows[0] as any)?.amount_minor ?? 0);
    const pendingAdjustmentsMinor = Number((adjustments.rows[0] as any)?.amount_minor ?? 0);
    return {
      currentPeriod,
      currentPeriodAccruedMinor,
      pendingAdjustmentsMinor,
      currentAccruedMinor: currentPeriodAccruedMinor + pendingAdjustmentsMinor,
      payouts: payouts.rows,
    };
  }

  async payoutsForTeacher(teacherId: string, actor: AuthUser) {
    if (actor.roles.includes("TEACHER") && actor.id !== teacherId) throw new ForbiddenException();
    const teacher = await this.db.execute(sql`SELECT user_id FROM teacher_profiles WHERE user_id = ${teacherId}`);
    if (!teacher.rowCount) throw new NotFoundException({ code: "TEACHER_NOT_FOUND", message: "Teacher not found" });
    const result = await this.db.execute(sql`
      SELECT p.id, p.amount_snapshot_minor, p.currency, p.status, p.paid_at, p.payout_destination_masked,
             pp.period_start, pp.period_end, pp.payout_window_start, pp.payout_window_end
      FROM teacher_payouts p
      JOIN payroll_periods pp ON pp.id = p.payroll_period_id
      WHERE p.teacher_id = ${teacherId}
      ORDER BY pp.period_start DESC
    `);
    return result.rows;
  }

  async financierTeachers(query?: string) {
    const result = await this.db.execute(sql`
      SELECT
        tp.user_id,
        tp.first_name,
        tp.last_name,
        tp.status,
        pd.masked_display,
        (pd.id IS NULL) AS missing_details,
        COALESCE((
          SELECT SUM(a.amount_minor)::bigint
          FROM payroll_accruals a
          WHERE a.teacher_id = tp.user_id
            AND NOT EXISTS (SELECT 1 FROM payroll_accrual_settlements s WHERE s.accrual_id = a.id)
        ), 0)::bigint AS unsettled_minor,
        COALESCE((
          SELECT json_agg(json_build_object('subject', x.subject_name, 'rate60Minor', x.rate_60) ORDER BY x.subject_name)
          FROM (
            SELECT s.name AS subject_name, tr.rate_60
            FROM teacher_subjects ts
            JOIN subjects s ON s.id = ts.subject_id
            JOIN LATERAL (
              SELECT rate_60_minor AS rate_60
              FROM teacher_rate_versions trv
              WHERE trv.teacher_subject_id = ts.id
                AND CURRENT_DATE >= trv.effective_from
                AND (trv.effective_until IS NULL OR CURRENT_DATE <= trv.effective_until)
              ORDER BY trv.effective_from DESC
              LIMIT 1
            ) tr ON true
            WHERE ts.teacher_id = tp.user_id AND ts.is_active = true
          ) x
        ), '[]'::json) AS rates,
        lp.amount_snapshot_minor AS last_payout_minor,
        lp.status AS last_payout_status,
        lp.paid_at AS last_paid_at
      FROM teacher_profiles tp
      LEFT JOIN LATERAL (
        SELECT id, masked_display
        FROM teacher_payout_details
        WHERE teacher_id = tp.user_id AND is_active = true
        ORDER BY created_at DESC
        LIMIT 1
      ) pd ON true
      LEFT JOIN LATERAL (
        SELECT amount_snapshot_minor, status, paid_at
        FROM teacher_payouts
        WHERE teacher_id = tp.user_id
        ORDER BY created_at DESC
        LIMIT 1
      ) lp ON true
      WHERE tp.archived_at IS NULL
        AND (
          ${query ?? null}::text IS NULL
          OR concat_ws(' ', tp.last_name, tp.first_name) ILIKE ('%' || ${query ?? null} || '%')
        )
      ORDER BY (pd.id IS NULL) DESC, tp.last_name, tp.first_name
    `);
    return result.rows;
  }

  async getDetails(teacherId: string, actor: AuthUser) {
    if (actor.roles.includes("TEACHER") && actor.id !== teacherId) throw new ForbiddenException();
    const teacher = await this.db.execute(sql`SELECT user_id FROM teacher_profiles WHERE user_id = ${teacherId}`);
    if (!teacher.rowCount) throw new NotFoundException({ code: "TEACHER_NOT_FOUND", message: "Teacher not found" });
    const result = await this.db.execute(sql`
      SELECT id, teacher_id, destination_type, details_encrypted, masked_display, is_active, created_at
      FROM teacher_payout_details
      WHERE teacher_id = ${teacherId} AND is_active = true
      ORDER BY created_at DESC
      LIMIT 1
    `);
    if (!result.rowCount) return null;
    const row = result.rows[0] as any;
    let details: string | undefined;
    if (actor.id === teacherId || actor.roles.includes("ADMIN") || actor.roles.includes("FINANCIER")) {
      try {
        details = this.decrypt(row.details_encrypted);
      } catch {
        details = undefined;
      }
    }
    return {
      id: row.id,
      teacherId: row.teacher_id,
      destinationType: row.destination_type,
      maskedDisplay: row.masked_display,
      details,
      createdAt: row.created_at,
    };
  }

  async setDetails(teacherId: string, dto: PayoutDetailsDto, actor: AuthUser, requestId?: string) {
    if (actor.roles.includes("TEACHER") && actor.id !== teacherId) throw new ForbiddenException();
    return this.db.transaction(async (tx) => {
      const teacher = await tx.execute(sql`SELECT user_id FROM teacher_profiles WHERE user_id = ${teacherId}`);
      if (!teacher.rowCount) throw new NotFoundException({ code: "TEACHER_NOT_FOUND", message: "Teacher not found" });
      const encrypted = this.encrypt(dto.details);
      await tx.execute(sql`
        UPDATE teacher_payout_details
        SET is_active = false
        WHERE teacher_id = ${teacherId} AND is_active = true
      `);
      const result = await tx.execute(sql`
        INSERT INTO teacher_payout_details(teacher_id, destination_type, details_encrypted, masked_display)
        VALUES(${teacherId}, ${dto.destinationType}, ${encrypted}, ${dto.maskedDisplay})
        RETURNING id, teacher_id, destination_type, masked_display, is_active, created_at
      `);

      // Unpaid payouts follow the latest requisites. Paid snapshots are protected by DB triggers.
      await tx.execute(sql`
        UPDATE teacher_payouts
        SET payout_destination_snapshot_encrypted = ${encrypted},
            payout_destination_masked = ${dto.maskedDisplay},
            status = 'READY'
        WHERE teacher_id = ${teacherId} AND status <> 'PAID'
      `);

      await this.audit.record(
        {
          actorUserId: actor.id,
          actorRoleCode: actor.roles[0],
          action: "UPDATE_PAYOUT_DETAILS",
          entityType: "TeacherProfile",
          entityId: teacherId,
          afterData: { destinationType: dto.destinationType, maskedDisplay: dto.maskedDisplay },
          requestId,
        },
        tx as any,
      );
      return result.rows[0];
    });
  }
}
