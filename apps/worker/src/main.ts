import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { createDatabase } from "@school/db";
import nodemailer from "nodemailer";
import { deliverTelegramNotifications } from "./notification-delivery.js";
import {
  cancelStaleNotifications,
  planBalanceNotifications,
  planLessonReminders,
  planUnmarkedLessonReminders,
} from "./notification-planner.js";
import { loadWorkerSettings } from "./settings.js";
import { processPdfOutbox } from "./pdf-processor.js";

// pnpm/turbo run package scripts with the package directory as cwd. Load the monorepo root .env first,
// then allow an optional package-local .env to fill only still-missing values.
loadEnv({ path: resolve(process.cwd(), "../../.env") });
loadEnv();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const { pool } = createDatabase(databaseUrl);
const pollMs = Number(process.env.WORKER_POLL_MS ?? "30000");
const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const webUrl = process.env.WEB_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
const releaseSha = process.env.RELEASE_SHA?.trim() || null;

async function recordHeartbeat(state: "starting" | "running" | "stopping") {
  await pool.query(
    `INSERT INTO service_heartbeats(service_name,last_seen_at,release_sha,metadata,updated_at)
     VALUES('worker',now(),$1,$2::jsonb,now())
     ON CONFLICT(service_name) DO UPDATE SET
       last_seen_at=EXCLUDED.last_seen_at,
       release_sha=EXCLUDED.release_sha,
       metadata=EXCLUDED.metadata,
       updated_at=now()`,
    [releaseSha, JSON.stringify({ state })],
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let stopping = false;
let resolveStop: (() => void) | undefined;
const stopSignal = new Promise<void>((resolve) => { resolveStop = resolve; });
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    console.log(`School worker received ${signal}; finishing current iteration.`);
    stopping = true;
    resolveStop?.();
  });
}

async function materializeNotificationOutbox() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const claimed = await client.query<any>(
      `SELECT id,event_type,payload
       FROM outbox_events
       WHERE status IN ('PENDING','FAILED')
         AND available_at<=now()
         AND event_type LIKE 'NOTIFY_%'
       ORDER BY available_at,created_at
       LIMIT 50
       FOR UPDATE SKIP LOCKED`,
    );

    for (const event of claimed.rows) {
      await client.query(`UPDATE outbox_events SET status='PROCESSING',attempts=attempts+1 WHERE id=$1`, [event.id]);
      const recipients = Array.isArray(event.payload?.recipientUserIds)
        ? [...new Set(event.payload.recipientUserIds.filter((value: unknown) => typeof value === "string"))]
        : [];
      const notification = event.payload?.notification;

      if (!notification?.eventType || !notification?.title || !recipients.length) {
        await client.query(`UPDATE outbox_events SET status='PROCESSED',processed_at=now() WHERE id=$1`, [event.id]);
        continue;
      }

      const scheduledAt = notification.scheduledAt ? new Date(notification.scheduledAt) : new Date();
      const expiresAt = notification.expiresAt ? new Date(notification.expiresAt) : null;
      for (const userId of recipients) {
        await client.query(
          `INSERT INTO notifications(
             user_id,event_type,source_outbox_event_id,scheduled_at,next_attempt_at,expires_at,status,payload
           ) VALUES($1,$2,$3,$4,$4,$5,'PENDING',$6::jsonb)
           ON CONFLICT(source_outbox_event_id,user_id) WHERE source_outbox_event_id IS NOT NULL DO NOTHING`,
          [userId, notification.eventType, event.id, scheduledAt, expiresAt, JSON.stringify(notification)],
        );
      }
      await client.query(`UPDATE outbox_events SET status='PROCESSED',processed_at=now() WHERE id=$1`, [event.id]);
    }

    await client.query("COMMIT");
    return claimed.rowCount ?? 0;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function maintainSystemState(settings: Awaited<ReturnType<typeof loadWorkerSettings>>) {
  await pool.query(`UPDATE course_licenses SET status='EXPIRED' WHERE status='ACTIVE' AND ends_at<=now()`);

  // Keep worker-generated payroll periods aligned with the same school settings used by the API.
  const anchor = new Date(`${settings.payrollAnchorDate}T00:00:00Z`);
  const periodDays = Math.max(1, Math.floor(settings.payrollPeriodDays));
  const payoutWindowDays = Math.max(1, Math.floor(settings.payrollPayoutWindowDays));
  const now = new Date();
  const diff = Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - anchor.getTime()) / 86_400_000);
  const cycle = Math.floor(diff / periodDays);

  for (let current = cycle - 1; current <= cycle + 2; current += 1) {
    const start = new Date(anchor);
    start.setUTCDate(start.getUTCDate() + current * periodDays);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + periodDays - 1);
    const payoutStart = new Date(end);
    payoutStart.setUTCDate(payoutStart.getUTCDate() + 1);
    const payoutEnd = new Date(payoutStart);
    payoutEnd.setUTCDate(payoutEnd.getUTCDate() + payoutWindowDays - 1);
    const date = (value: Date) => value.toISOString().slice(0, 10);

    await pool.query(
      `INSERT INTO payroll_periods(period_start,period_end,payout_window_start,payout_window_end)
       VALUES($1,$2,$3,$4)
       ON CONFLICT(period_start,period_end) DO NOTHING`,
      [date(start), date(end), date(payoutStart), date(payoutEnd)],
    );
  }

  // Dedupe keys are operational data, not school history.
  await pool.query(`DELETE FROM worker_dedup_keys WHERE created_at < now()-interval '180 days'`);
}

function mailTransport() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  });
}

async function deliverEmailOutbox() {
  const rows = await pool.query<any>(
    `SELECT id,event_type,payload
     FROM outbox_events
     WHERE status IN ('PENDING','FAILED')
       AND available_at<=now()
       AND event_type IN ('EMAIL_INVITATION','EMAIL_PASSWORD_RESET')
     ORDER BY created_at
     LIMIT 20`,
  );
  const transport = mailTransport();

  for (const event of rows.rows) {
    const claimed = await pool.query(
      `UPDATE outbox_events
       SET status='PROCESSING',attempts=attempts+1
       WHERE id=$1 AND status IN ('PENDING','FAILED')
       RETURNING id`,
      [event.id],
    );
    if (!claimed.rowCount) continue;

    try {
      const email = event.payload?.email;
      const token = event.payload?.token;
      if (!email || !token) throw new Error("Missing email/token");
      const path = event.event_type === "EMAIL_INVITATION"
        ? `/accept-invite?token=${encodeURIComponent(token)}`
        : `/reset-password?token=${encodeURIComponent(token)}`;
      const url = `${webUrl}${path}`;
      const subject = event.event_type === "EMAIL_INVITATION" ? "Запрошення до School Platform" : "Відновлення пароля";
      const text = event.event_type === "EMAIL_INVITATION"
        ? `Вас запросили до School Platform. Створіть пароль: ${url}`
        : `Щоб змінити пароль, відкрийте: ${url}`;

      if (transport) {
        await transport.sendMail({
          from: process.env.EMAIL_FROM || "School Platform <no-reply@localhost>",
          to: email,
          subject,
          text,
          html: `<p>${text.split(url)[0]}</p><p><a href="${url}">${url}</a></p>`,
        });
      } else {
        console.log(`[email preview] ${email}: ${subject} ${url}`);
      }
      await pool.query(`UPDATE outbox_events SET status='PROCESSED',processed_at=now() WHERE id=$1`, [event.id]);
    } catch (error) {
      await pool.query(`UPDATE outbox_events SET status='FAILED' WHERE id=$1`, [event.id]);
      console.error("Email delivery failed", error);
    }
  }
}

async function run() {
  console.log("School worker started");
  await recordHeartbeat("starting");
  while (!stopping) {
    try {
      await recordHeartbeat("running");
      const settings = await loadWorkerSettings(pool);
      await materializeNotificationOutbox();
      await deliverEmailOutbox();
      await processPdfOutbox(pool);
      await planLessonReminders(pool, settings);
      await planUnmarkedLessonReminders(pool, settings);
      await planBalanceNotifications(pool, settings);
      await cancelStaleNotifications(pool, settings);
      await maintainSystemState(settings);
      await deliverTelegramNotifications(pool, { telegramToken, webUrl, settings });
    } catch (error) {
      console.error("Worker iteration failed", error);
    }
    await Promise.race([sleep(pollMs), stopSignal]);
  }
  try { await recordHeartbeat("stopping"); } catch {}
  await pool.end();
  console.log("School worker stopped");
}

run().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
