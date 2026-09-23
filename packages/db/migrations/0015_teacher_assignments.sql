CREATE TABLE IF NOT EXISTS teacher_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL REFERENCES student_subject_enrollments(id) ON DELETE RESTRICT,
  teacher_id UUID NOT NULL REFERENCES teacher_profiles(user_id) ON DELETE RESTRICT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  assigned_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT teacher_assignment_dates_chk CHECK (
    ended_at IS NULL OR ended_at > started_at
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_teacher_per_enrollment
  ON teacher_assignments(enrollment_id)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS teacher_assignments_teacher_idx
  ON teacher_assignments(teacher_id, started_at DESC);
