DO $$ BEGIN
  CREATE TYPE enrollment_status AS ENUM ('ACTIVE', 'PAUSED', 'INACTIVE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS student_subject_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  status enrollment_status NOT NULL DEFAULT 'ACTIVE',
  default_duration_minutes SMALLINT NOT NULL DEFAULT 60,
  started_at DATE NOT NULL DEFAULT CURRENT_DATE,
  paused_at TIMESTAMPTZ,
  inactive_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT student_subject_enrollment_uq UNIQUE (student_id, subject_id),
  CONSTRAINT enrollment_duration_chk CHECK (default_duration_minutes IN (30, 60))
);

CREATE INDEX IF NOT EXISTS enrollments_student_idx
  ON student_subject_enrollments(student_id, status);

CREATE INDEX IF NOT EXISTS enrollments_subject_idx
  ON student_subject_enrollments(subject_id, status);
