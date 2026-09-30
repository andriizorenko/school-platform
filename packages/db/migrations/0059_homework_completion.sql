ALTER TABLE live_sessions
  ADD COLUMN IF NOT EXISTS homework_completed_at TIMESTAMPTZ;
