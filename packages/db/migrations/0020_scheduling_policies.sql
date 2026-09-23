DO $$ BEGIN
  CREATE TYPE session_incident_type AS ENUM ('STUDENT_NO_SHOW', 'TEACHER_LATE_CANCELLATION');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS session_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES live_sessions(id) ON DELETE RESTRICT,
  type session_incident_type NOT NULL,
  responsible_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  policy_strike_number SMALLINT NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT session_incident_strike_chk CHECK (policy_strike_number IN (1, 2))
);

CREATE INDEX IF NOT EXISTS session_incidents_session_idx
  ON session_incidents(session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS student_attendance_policy_states (
  enrollment_id UUID PRIMARY KEY REFERENCES student_subject_enrollments(id) ON DELETE RESTRICT,
  strike_count SMALLINT NOT NULL DEFAULT 0,
  clean_streak SMALLINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT student_attendance_strike_chk CHECK (strike_count BETWEEN 0 AND 1),
  CONSTRAINT student_attendance_streak_chk CHECK (clean_streak BETWEEN 0 AND 5)
);

CREATE TABLE IF NOT EXISTS teacher_student_policy_states (
  enrollment_id UUID NOT NULL REFERENCES student_subject_enrollments(id) ON DELETE RESTRICT,
  teacher_id UUID NOT NULL REFERENCES teacher_profiles(user_id) ON DELETE RESTRICT,
  strike_count SMALLINT NOT NULL DEFAULT 0,
  clean_streak SMALLINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (enrollment_id, teacher_id),
  CONSTRAINT teacher_student_strike_chk CHECK (strike_count BETWEEN 0 AND 1),
  CONSTRAINT teacher_student_streak_chk CHECK (clean_streak BETWEEN 0 AND 5)
);

CREATE TABLE IF NOT EXISTS student_enrollment_pauses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL REFERENCES student_subject_enrollments(id) ON DELETE RESTRICT,
  starts_on DATE NOT NULL,
  returns_on DATE NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT student_enrollment_pause_dates_chk CHECK (returns_on > starts_on)
);

CREATE INDEX IF NOT EXISTS student_enrollment_pauses_idx
  ON student_enrollment_pauses(enrollment_id, starts_on, returns_on);
