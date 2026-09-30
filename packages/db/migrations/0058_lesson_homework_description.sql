ALTER TABLE live_sessions
  ADD COLUMN IF NOT EXISTS homework_description TEXT;
