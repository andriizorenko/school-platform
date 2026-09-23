ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS dedup_key TEXT,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

UPDATE notifications
SET next_attempt_at = scheduled_at
WHERE next_attempt_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_event_dedup_uidx
  ON notifications(user_id, event_type, dedup_key)
  WHERE dedup_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS notifications_due_retry_idx
  ON notifications(status, next_attempt_at, scheduled_at)
  WHERE status IN ('PENDING', 'FAILED');

CREATE INDEX IF NOT EXISTS notifications_expires_idx
  ON notifications(expires_at)
  WHERE expires_at IS NOT NULL AND status IN ('PENDING', 'FAILED', 'PROCESSING');

INSERT INTO school_settings(key, value, description)
VALUES
  ('lesson_reminder_minutes', '60', 'Minutes before a live lesson when parent/student reminders are scheduled'),
  ('notification_planning_horizon_hours', '48', 'How far ahead the worker plans timed notifications'),
  ('unmarked_reminder_local_hour', '10', 'Local hour on the next day for an unmarked-lesson reminder'),
  ('notification_retry_max_attempts', '5', 'Maximum Telegram delivery attempts'),
  ('notification_retry_base_seconds', '60', 'Base exponential backoff for Telegram retries'),
  ('school_timezone', '"Europe/Kyiv"', 'IANA timezone used for school lifecycle jobs')
ON CONFLICT (key) DO NOTHING;
