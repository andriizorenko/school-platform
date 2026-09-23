import type { Pool } from "pg";

export interface WorkerSettings {
  lessonReminderMinutes: number;
  planningHorizonHours: number;
  unmarkedReminderLocalHour: number;
  notificationRetryMaxAttempts: number;
  notificationRetryBaseSeconds: number;
  schoolTimezone: string;
  teacherMarkDeadlineHours: number;
  lowBalanceLessonUnits: number;
  payrollAnchorDate: string;
  payrollPeriodDays: number;
  payrollPayoutWindowDays: number;
}

const defaults: WorkerSettings = {
  lessonReminderMinutes: 60,
  planningHorizonHours: 48,
  unmarkedReminderLocalHour: 10,
  notificationRetryMaxAttempts: 5,
  notificationRetryBaseSeconds: 60,
  schoolTimezone: "Europe/Kyiv",
  teacherMarkDeadlineHours: 48,
  lowBalanceLessonUnits: 3,
  payrollAnchorDate: "2026-09-07",
  payrollPeriodDays: 14,
  payrollPayoutWindowDays: 3,
};

function numberSetting(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringSetting(value: unknown, fallback: string) {
  if (typeof value === "string" && value.trim()) return value;
  return fallback;
}

export async function loadWorkerSettings(pool: Pool): Promise<WorkerSettings> {
  const keys = [
    "lesson_reminder_minutes",
    "notification_planning_horizon_hours",
    "unmarked_reminder_local_hour",
    "notification_retry_max_attempts",
    "notification_retry_base_seconds",
    "school_timezone",
    "teacher_mark_deadline_hours",
    "low_balance_lesson_units",
    "payroll_anchor_date",
    "payroll_period_days",
    "payroll_payout_window_days",
  ];

  const result = await pool.query<{ key: string; value: unknown }>(
    `SELECT key, value FROM school_settings WHERE key = ANY($1::text[])`,
    [keys],
  );
  const map = new Map(result.rows.map((row) => [row.key, row.value]));

  return {
    lessonReminderMinutes: numberSetting(map.get("lesson_reminder_minutes"), defaults.lessonReminderMinutes),
    planningHorizonHours: numberSetting(map.get("notification_planning_horizon_hours"), defaults.planningHorizonHours),
    unmarkedReminderLocalHour: numberSetting(map.get("unmarked_reminder_local_hour"), defaults.unmarkedReminderLocalHour),
    notificationRetryMaxAttempts: numberSetting(map.get("notification_retry_max_attempts"), defaults.notificationRetryMaxAttempts),
    notificationRetryBaseSeconds: numberSetting(map.get("notification_retry_base_seconds"), defaults.notificationRetryBaseSeconds),
    schoolTimezone: stringSetting(map.get("school_timezone"), defaults.schoolTimezone),
    teacherMarkDeadlineHours: numberSetting(map.get("teacher_mark_deadline_hours"), defaults.teacherMarkDeadlineHours),
    lowBalanceLessonUnits: numberSetting(map.get("low_balance_lesson_units"), defaults.lowBalanceLessonUnits),
    payrollAnchorDate: stringSetting(map.get("payroll_anchor_date"), defaults.payrollAnchorDate),
    payrollPeriodDays: numberSetting(map.get("payroll_period_days"), defaults.payrollPeriodDays),
    payrollPayoutWindowDays: numberSetting(map.get("payroll_payout_window_days"), defaults.payrollPayoutWindowDays),
  };
}
