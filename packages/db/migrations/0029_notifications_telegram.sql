DO $$ BEGIN
  CREATE TYPE notification_channel AS ENUM ('TELEGRAM', 'EMAIL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE notification_status AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE notification_delivery_status AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE telegram_connection_status AS ENUM ('ACTIVE', 'DISCONNECTED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS notification_event_types (
  code TEXT PRIMARY KEY,
  user_configurable BOOLEAN NOT NULL DEFAULT true,
  default_enabled BOOLEAN NOT NULL DEFAULT true,
  description TEXT
);

INSERT INTO notification_event_types (code, user_configurable, default_enabled, description)
VALUES
  ('LESSON_REMINDER', true, true, 'Reminder before a live lesson'),
  ('LESSON_RESCHEDULED', true, true, 'A lesson was rescheduled'),
  ('REGULAR_SCHEDULE_CHANGED', true, true, 'Regular tutoring schedule changed'),
  ('FIRST_LESSON_ASSIGNED', true, true, 'Teacher received a new first lesson'),
  ('REGULAR_STUDENT_ASSIGNED', true, true, 'Teacher received a new regular student'),
  ('LOW_BALANCE', true, true, 'Lesson balance reached the low-balance threshold'),
  ('ZERO_BALANCE', true, true, 'Lesson balance reached zero'),
  ('REPORT_REQUESTED', true, true, 'Parent requested a progress report'),
  ('REPORT_READY', true, true, 'A progress report is ready'),
  ('COURSE_ACCESS_GRANTED', true, true, 'Course access was granted'),
  ('UNMARKED_LESSON_REMINDER', true, true, 'Teacher has an unmarked lesson'),
  ('TEACHER_VACATION_APPROVED', true, true, 'Teacher vacation request was approved'),
  ('TEACHER_VACATION_REJECTED', true, true, 'Teacher vacation request was rejected'),
  ('SECURITY_ACCOUNT_CHANGED', false, true, 'Security-related account change')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL REFERENCES notification_event_types(code) ON DELETE RESTRICT,
  channel notification_channel NOT NULL,
  enabled BOOLEAN NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_type, channel)
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL REFERENCES notification_event_types(code) ON DELETE RESTRICT,
  source_outbox_event_id UUID REFERENCES outbox_events(id) ON DELETE RESTRICT,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status notification_status NOT NULL DEFAULT 'PENDING',
  payload JSONB NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS notifications_outbox_user_uidx
  ON notifications(source_outbox_event_id, user_id)
  WHERE source_outbox_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_pending_idx
  ON notifications(status, scheduled_at)
  WHERE status IN ('PENDING', 'FAILED');

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE RESTRICT,
  channel notification_channel NOT NULL,
  status notification_delivery_status NOT NULL DEFAULT 'PENDING',
  provider TEXT,
  provider_message_id TEXT,
  error TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_deliveries_notification_idx
  ON notification_deliveries(notification_id, attempted_at DESC);

CREATE TABLE IF NOT EXISTS telegram_connections (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  telegram_user_id BIGINT NOT NULL UNIQUE,
  telegram_chat_id BIGINT NOT NULL UNIQUE,
  username TEXT,
  status telegram_connection_status NOT NULL DEFAULT 'ACTIVE',
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  disconnected_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS telegram_link_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS telegram_link_tokens_user_active_idx
  ON telegram_link_tokens(user_id, expires_at DESC)
  WHERE used_at IS NULL;
