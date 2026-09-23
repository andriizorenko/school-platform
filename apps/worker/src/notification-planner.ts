import type { Pool } from "pg";
import type { WorkerSettings } from "./settings.js";
import { balanceNotificationDedupKey, lessonReminderDedupKey, unmarkedReminderDedupKey } from "./notification-utils.js";

type Recipient = { userId: string; actionPath: string };

async function insertPlannedNotification(
  pool: Pool,
  input: {
    userId: string;
    eventType: string;
    dedupKey: string;
    scheduledAt: Date;
    expiresAt?: Date;
    payload: Record<string, unknown>;
  },
) {
  await pool.query(
    `INSERT INTO notifications(
       user_id,event_type,dedup_key,scheduled_at,next_attempt_at,expires_at,status,payload
     ) VALUES($1,$2,$3,$4,$4,$5,'PENDING',$6::jsonb)
     ON CONFLICT(user_id,event_type,dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING`,
    [
      input.userId,
      input.eventType,
      input.dedupKey,
      input.scheduledAt,
      input.expiresAt ?? null,
      JSON.stringify(input.payload),
    ],
  );
}

export async function planLessonReminders(pool: Pool, settings: WorkerSettings) {
  const result = await pool.query<any>(
    `SELECT
       ls.id,
       ls.starts_at,
       st.user_id AS student_user_id,
       pp.user_id AS parent_user_id,
       st.first_name,
       st.last_name,
       sub.name AS subject_name
     FROM live_sessions ls
     JOIN students st ON st.id=ls.student_id
     JOIN subjects sub ON sub.id=ls.subject_id
     LEFT JOIN parent_profiles pp ON pp.family_id=st.family_id
     WHERE ls.status='SCHEDULED'
       AND ls.starts_at > now()
       AND ls.starts_at <= now() + ($1::text || ' hours')::interval`,
    [settings.planningHorizonHours],
  );

  let created = 0;
  for (const row of result.rows) {
    const startsAt = new Date(row.starts_at);
    const plannedAt = new Date(startsAt.getTime() - settings.lessonReminderMinutes * 60_000);
    const scheduledAt = plannedAt.getTime() > Date.now() ? plannedAt : new Date();
    const recipients: Recipient[] = [];
    if (row.parent_user_id) recipients.push({ userId: row.parent_user_id, actionPath: "/parent/schedule" });
    if (row.student_user_id) recipients.push({ userId: row.student_user_id, actionPath: "/student/schedule" });

    for (const recipient of recipients) {
      await insertPlannedNotification(pool, {
        userId: recipient.userId,
        eventType: "LESSON_REMINDER",
        dedupKey: lessonReminderDedupKey(row.id, startsAt),
        scheduledAt,
        expiresAt: startsAt,
        payload: {
          title: "Заняття через годину",
          body: `${row.last_name} ${row.first_name} · ${row.subject_name}`,
          actionPath: recipient.actionPath,
          data: { sessionId: row.id, startsAt: startsAt.toISOString() },
        },
      });
      created += 1;
    }
  }
  return created;
}

export async function planUnmarkedLessonReminders(pool: Pool, settings: WorkerSettings) {
  const result = await pool.query<any>(
    `SELECT
       ls.id,
       ls.ends_at,
       ls.actual_teacher_id,
       st.first_name,
       st.last_name,
       sub.name AS subject_name,
       (
         (
           date_trunc('day', ls.ends_at AT TIME ZONE $1)
           + interval '1 day'
           + ($2::text || ' hours')::interval
         ) AT TIME ZONE $1
       ) AS reminder_at
     FROM live_sessions ls
     JOIN students st ON st.id=ls.student_id
     JOIN subjects sub ON sub.id=ls.subject_id
     WHERE ls.status='SCHEDULED'
       AND ls.funding_status='PAID'
       AND ls.ends_at < now()
       AND ls.ends_at > now() - ($3::text || ' hours')::interval`,
    [settings.schoolTimezone, settings.unmarkedReminderLocalHour, settings.teacherMarkDeadlineHours],
  );

  let created = 0;
  for (const row of result.rows) {
    const endsAt = new Date(row.ends_at);
    const markDeadline = new Date(endsAt.getTime() + settings.teacherMarkDeadlineHours * 60 * 60_000);
    let scheduledAt = new Date(row.reminder_at);
    if (scheduledAt.getTime() < Date.now()) scheduledAt = new Date();
    if (scheduledAt >= markDeadline) continue;

    await insertPlannedNotification(pool, {
      userId: row.actual_teacher_id,
      eventType: "UNMARKED_LESSON_REMINDER",
      dedupKey: unmarkedReminderDedupKey(row.id, endsAt),
      scheduledAt,
      expiresAt: markDeadline,
      payload: {
        title: "Не забудьте відмітити урок",
        body: `${row.last_name} ${row.first_name} · ${row.subject_name}`,
        actionPath: "/teacher",
        data: { sessionId: row.id, endsAt: endsAt.toISOString() },
      },
    });
    created += 1;
  }
  return created;
}

export async function planBalanceNotifications(pool: Pool, settings: WorkerSettings) {
  const result = await pool.query<any>(
    `SELECT
       e.id AS enrollment_id,
       st.first_name,
       st.last_name,
       pp.user_id AS parent_user_id,
       sub.name AS subject_name,
       (
         COALESCE((SELECT SUM(g.credits_granted) FROM lesson_credit_grants g WHERE g.enrollment_id=e.id),0)
         - COALESCE((SELECT SUM(d.credits_debited) FROM lesson_credit_debits d WHERE d.enrollment_id=e.id),0)
       )::int AS credits,
       COALESCE(
         (SELECT g.id::text FROM lesson_credit_grants g WHERE g.enrollment_id=e.id ORDER BY g.created_at DESC, g.id DESC LIMIT 1),
         'initial'
       ) AS balance_cycle_id
     FROM student_subject_enrollments e
     JOIN students st ON st.id=e.student_id
     JOIN subjects sub ON sub.id=e.subject_id
     LEFT JOIN parent_profiles pp ON pp.family_id=st.family_id
     WHERE e.status='ACTIVE'`,
  );

  let created = 0;
  for (const row of result.rows) {
    if (!row.parent_user_id) continue;
    const lessonUnits = Number(row.credits) / 2;
    const baseData = {
      enrollmentId: row.enrollment_id,
      balanceLessonUnits: lessonUnits,
      balanceCycleId: row.balance_cycle_id,
    };

    if (lessonUnits > 0 && lessonUnits <= settings.lowBalanceLessonUnits) {
      await insertPlannedNotification(pool, {
        userId: row.parent_user_id,
        eventType: "LOW_BALANCE",
        dedupKey: balanceNotificationDedupKey("low", row.enrollment_id, row.balance_cycle_id),
        scheduledAt: new Date(),
        payload: {
          title: `Залишилось ${lessonUnits} заняття`,
          body: `${row.last_name} ${row.first_name} · ${row.subject_name}. Поповніть баланс, щоб зберегти графік.`,
          actionPath: "/parent/payments",
          data: baseData,
        },
      });
      created += 1;
    }

    if (lessonUnits <= 0) {
      await insertPlannedNotification(pool, {
        userId: row.parent_user_id,
        eventType: "ZERO_BALANCE",
        dedupKey: balanceNotificationDedupKey("zero", row.enrollment_id, row.balance_cycle_id),
        scheduledAt: new Date(),
        payload: {
          title: "Баланс занять вичерпано",
          body: `${row.last_name} ${row.first_name} · ${row.subject_name}. Регулярні години бронюються лише протягом резервного періоду.`,
          actionPath: "/parent/payments",
          data: baseData,
        },
      });
      created += 1;
    }
  }
  return created;
}

export async function cancelStaleNotifications(pool: Pool, settings: WorkerSettings) {
  const recovered = await pool.query(
    `UPDATE notifications
     SET status='PENDING', next_attempt_at=now(), last_error='Recovered after interrupted delivery'
     WHERE status='PROCESSING'
       AND last_attempt_at IS NOT NULL
       AND last_attempt_at < now()-interval '10 minutes'
       AND (expires_at IS NULL OR expires_at > now())`,
  );

  const expired = await pool.query(
    `UPDATE notifications
     SET status='CANCELLED', last_error=COALESCE(last_error,'Notification expired before delivery')
     WHERE status IN ('PENDING','FAILED','PROCESSING')
       AND expires_at IS NOT NULL
       AND expires_at <= now()`,
  );

  const staleLessons = await pool.query(
    `UPDATE notifications n
     SET status='CANCELLED', last_error='Lesson changed after reminder was planned'
     FROM live_sessions ls
     WHERE n.event_type='LESSON_REMINDER'
       AND n.status IN ('PENDING','FAILED')
       AND ls.id::text = n.payload #>> '{data,sessionId}'
       AND (
         ls.status <> 'SCHEDULED'
         OR ls.starts_at <> (n.payload #>> '{data,startsAt}')::timestamptz
       )`,
  );

  const resolvedUnmarked = await pool.query(
    `UPDATE notifications n
     SET status='CANCELLED', last_error='Lesson no longer needs marking reminder'
     FROM live_sessions ls
     WHERE n.event_type='UNMARKED_LESSON_REMINDER'
       AND n.status IN ('PENDING','FAILED')
       AND ls.id::text = n.payload #>> '{data,sessionId}'
       AND ls.status <> 'SCHEDULED'`,
  );

  const staleLow = await pool.query(
    `WITH balance AS (
       SELECT e.id,
         (
           COALESCE((SELECT SUM(g.credits_granted) FROM lesson_credit_grants g WHERE g.enrollment_id=e.id),0)
           - COALESCE((SELECT SUM(d.credits_debited) FROM lesson_credit_debits d WHERE d.enrollment_id=e.id),0)
         )::numeric / 2 AS lesson_units
       FROM student_subject_enrollments e
     )
     UPDATE notifications n
     SET status='CANCELLED', last_error='Balance changed before notification delivery'
     FROM balance b
     WHERE n.event_type='LOW_BALANCE'
       AND n.status IN ('PENDING','FAILED')
       AND b.id::text = n.payload #>> '{data,enrollmentId}'
       AND NOT (b.lesson_units > 0 AND b.lesson_units <= $1)`,
    [settings.lowBalanceLessonUnits],
  );

  const staleZero = await pool.query(
    `WITH balance AS (
       SELECT e.id,
         COALESCE((SELECT SUM(g.credits_granted) FROM lesson_credit_grants g WHERE g.enrollment_id=e.id),0)
         - COALESCE((SELECT SUM(d.credits_debited) FROM lesson_credit_debits d WHERE d.enrollment_id=e.id),0) AS credits
       FROM student_subject_enrollments e
     )
     UPDATE notifications n
     SET status='CANCELLED', last_error='Balance was replenished before notification delivery'
     FROM balance b
     WHERE n.event_type='ZERO_BALANCE'
       AND n.status IN ('PENDING','FAILED')
       AND b.id::text = n.payload #>> '{data,enrollmentId}'
       AND b.credits > 0`,
  );

  const disabled = await pool.query(
    `WITH skipped AS (
       SELECT n.id
       FROM notifications n
       JOIN notification_event_types et ON et.code=n.event_type
       LEFT JOIN notification_preferences pref
         ON pref.user_id=n.user_id AND pref.event_type=n.event_type AND pref.channel='TELEGRAM'
       WHERE n.status IN ('PENDING','FAILED')
         AND COALESCE(pref.enabled,et.default_enabled)=false
     ), updated AS (
       UPDATE notifications n
       SET status='CANCELLED', last_error='Disabled by notification preferences'
       FROM skipped s
       WHERE n.id=s.id
       RETURNING n.id
     )
     INSERT INTO notification_deliveries(notification_id,channel,status,provider,error)
     SELECT id,'TELEGRAM','SKIPPED','telegram','Disabled by notification preferences'
     FROM updated`,
  );

  return {
    recovered: recovered.rowCount ?? 0,
    expired: expired.rowCount ?? 0,
    staleLessons: staleLessons.rowCount ?? 0,
    resolvedUnmarked: resolvedUnmarked.rowCount ?? 0,
    staleLow: staleLow.rowCount ?? 0,
    staleZero: staleZero.rowCount ?? 0,
    disabled: disabled.rowCount ?? 0,
  };
}
