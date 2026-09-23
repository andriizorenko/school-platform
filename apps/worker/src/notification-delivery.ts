import type { Pool } from "pg";
import type { WorkerSettings } from "./settings.js";
import { retryDelaySeconds } from "./notification-utils.js";

export async function deliverTelegramNotifications(
  pool: Pool,
  input: { telegramToken?: string; webUrl: string; settings: WorkerSettings },
) {
  if (!input.telegramToken) return 0;

  const rows = await pool.query<any>(
    `SELECT
       n.id,
       tc.telegram_chat_id::text,
       n.event_type,
       n.payload,
       n.attempts
     FROM notifications n
     JOIN notification_event_types et ON et.code=n.event_type
     JOIN telegram_connections tc ON tc.user_id=n.user_id AND tc.status='ACTIVE'
     LEFT JOIN notification_preferences pref
       ON pref.user_id=n.user_id AND pref.event_type=n.event_type AND pref.channel='TELEGRAM'
     WHERE n.status IN ('PENDING','FAILED')
       AND n.attempts < $1
       AND n.scheduled_at <= now()
       AND COALESCE(n.next_attempt_at,n.scheduled_at) <= now()
       AND (n.expires_at IS NULL OR n.expires_at > now())
       AND COALESCE(pref.enabled,et.default_enabled)=true
     ORDER BY COALESCE(n.next_attempt_at,n.scheduled_at), n.created_at
     LIMIT 50`,
    [input.settings.notificationRetryMaxAttempts],
  );

  for (const row of rows.rows) {
    const claimed = await pool.query<{ attempts: number }>(
      `UPDATE notifications
       SET status='PROCESSING', attempts=attempts+1, last_attempt_at=now()
       WHERE id=$1
         AND status IN ('PENDING','FAILED')
         AND attempts < $2
       RETURNING attempts`,
      [row.id, input.settings.notificationRetryMaxAttempts],
    );
    if (!claimed.rowCount) continue;

    const attemptNumber = claimed.rows[0].attempts;
    const title = row.payload?.title ?? "Сповіщення";
    const body = row.payload?.body ?? "";
    const text = body ? `${title}\n\n${body}` : title;
    const actionUrl = row.payload?.actionPath
      ? `${input.webUrl}${row.payload.actionPath.startsWith("/") ? "" : "/"}${row.payload.actionPath}`
      : null;

    try {
      const response = await fetch(`https://api.telegram.org/bot${input.telegramToken}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: row.telegram_chat_id,
          text,
          disable_web_page_preview: true,
          ...(actionUrl ? { reply_markup: { inline_keyboard: [[{ text: "Відкрити", url: actionUrl }]] } } : {}),
        }),
      });
      const result: any = await response.json();
      if (!response.ok || !result?.ok) throw new Error(result?.description ?? `Telegram HTTP ${response.status}`);

      await pool.query(
        `INSERT INTO notification_deliveries(notification_id,channel,status,provider,provider_message_id)
         VALUES($1,'TELEGRAM','SENT','telegram',$2)`,
        [row.id, String(result.result?.message_id ?? "")],
      );
      await pool.query(
        `UPDATE notifications
         SET status='SENT', sent_at=now(), next_attempt_at=NULL, last_error=NULL
         WHERE id=$1`,
        [row.id],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Telegram error";
      const terminal = attemptNumber >= input.settings.notificationRetryMaxAttempts;
      const retrySeconds = retryDelaySeconds(input.settings.notificationRetryBaseSeconds, attemptNumber);

      await pool.query(
        `INSERT INTO notification_deliveries(notification_id,channel,status,provider,error)
         VALUES($1,'TELEGRAM','FAILED','telegram',$2)`,
        [row.id, message.slice(0, 2000)],
      );
      await pool.query(
        `UPDATE notifications
         SET status=$2::notification_status,
             next_attempt_at=CASE WHEN $2='PENDING' THEN now()+($3::text || ' seconds')::interval ELSE NULL END,
             last_error=$4
         WHERE id=$1`,
        [row.id, terminal ? "FAILED" : "PENDING", retrySeconds, message.slice(0, 2000)],
      );
    }
  }

  return rows.rowCount ?? 0;
}
