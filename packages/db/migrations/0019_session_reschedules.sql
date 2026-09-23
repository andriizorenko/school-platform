DO $$ BEGIN
  CREATE TYPE reschedule_reason AS ENUM (
    'PARENT_REQUEST',
    'STUDENT_CANNOT_ATTEND',
    'STUDENT_NO_SHOW',
    'TEACHER_TECHNICAL',
    'TEACHER_PERSONAL',
    'TEACHER_VACATION',
    'STUDENT_PAUSE',
    'SCHOOL_REASON',
    'OTHER'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE reschedule_mode AS ENUM ('FREE_SLOT', 'END_OF_PAID_SEQUENCE', 'MANUAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS session_reschedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES live_sessions(id) ON DELETE RESTRICT,
  from_start_at TIMESTAMPTZ NOT NULL,
  from_end_at TIMESTAMPTZ NOT NULL,
  to_start_at TIMESTAMPTZ NOT NULL,
  to_end_at TIMESTAMPTZ NOT NULL,
  reason reschedule_reason NOT NULL,
  mode reschedule_mode NOT NULL,
  comment TEXT,
  initiated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT session_reschedule_from_time_chk CHECK (from_end_at > from_start_at),
  CONSTRAINT session_reschedule_to_time_chk CHECK (to_end_at > to_start_at)
);

CREATE INDEX IF NOT EXISTS session_reschedules_session_idx
  ON session_reschedules(session_id, created_at DESC);
