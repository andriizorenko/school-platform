DO $$ BEGIN
  CREATE TYPE session_incident_outcome AS ENUM (
    'RESCHEDULE_REQUIRED_NO_CHARGE',
    'CHARGED_NO_SHOW',
    'COMPENSATION_GRANTED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE session_incidents
  ADD COLUMN IF NOT EXISTS outcome session_incident_outcome,
  ADD COLUMN IF NOT EXISTS comment TEXT,
  ADD COLUMN IF NOT EXISTS responsible_student_id UUID REFERENCES students(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS responsible_teacher_id UUID REFERENCES teacher_profiles(user_id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS session_incidents_policy_idx
  ON session_incidents(type, created_at DESC);
