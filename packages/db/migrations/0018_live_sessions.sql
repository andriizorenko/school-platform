DO $$ BEGIN
  CREATE TYPE session_type AS ENUM ('FIRST', 'REGULAR');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE session_funding_status AS ENUM ('BOOKED', 'PAID');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE live_session_status AS ENUM ('SCHEDULED', 'COMPLETED', 'CHARGED_NO_SHOW', 'CANCELLED', 'EXPIRED_UNPAID');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS live_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  enrollment_id UUID REFERENCES student_subject_enrollments(id) ON DELETE RESTRICT,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  primary_teacher_id UUID NOT NULL REFERENCES teacher_profiles(user_id) ON DELETE RESTRICT,
  actual_teacher_id UUID NOT NULL REFERENCES teacher_profiles(user_id) ON DELETE RESTRICT,
  schedule_slot_id UUID REFERENCES regular_schedule_slots(id) ON DELETE RESTRICT,
  occurrence_date DATE,
  session_type session_type NOT NULL,
  funding_status session_funding_status NOT NULL,
  status live_session_status NOT NULL DEFAULT 'SCHEDULED',
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  topic_title TEXT,
  homework_assigned BOOLEAN,
  marked_at TIMESTAMPTZ,
  marked_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT live_session_time_chk CHECK (ends_at > starts_at),
  CONSTRAINT regular_session_enrollment_chk CHECK (
    session_type <> 'REGULAR' OR enrollment_id IS NOT NULL
  ),
  CONSTRAINT materialized_occurrence_chk CHECK (
    (schedule_slot_id IS NULL AND occurrence_date IS NULL)
    OR
    (schedule_slot_id IS NOT NULL AND occurrence_date IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS live_session_schedule_occurrence_uidx
  ON live_sessions(schedule_slot_id, occurrence_date)
  WHERE schedule_slot_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS live_sessions_teacher_calendar_idx
  ON live_sessions(actual_teacher_id, starts_at);

CREATE INDEX IF NOT EXISTS live_sessions_student_calendar_idx
  ON live_sessions(student_id, starts_at);

CREATE INDEX IF NOT EXISTS live_sessions_subject_calendar_idx
  ON live_sessions(subject_id, starts_at);

ALTER TABLE live_sessions
  DROP CONSTRAINT IF EXISTS teacher_session_no_overlap;

ALTER TABLE live_sessions
  ADD CONSTRAINT teacher_session_no_overlap
  EXCLUDE USING gist (
    actual_teacher_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
  WHERE (status IN ('SCHEDULED', 'COMPLETED', 'CHARGED_NO_SHOW'));

ALTER TABLE live_sessions
  DROP CONSTRAINT IF EXISTS student_session_no_overlap;

ALTER TABLE live_sessions
  ADD CONSTRAINT student_session_no_overlap
  EXCLUDE USING gist (
    student_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
  WHERE (status IN ('SCHEDULED', 'COMPLETED', 'CHARGED_NO_SHOW'));
