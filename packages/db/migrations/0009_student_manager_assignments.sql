CREATE TABLE IF NOT EXISTS student_manager_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  manager_user_id UUID NOT NULL REFERENCES staff_profiles(user_id) ON DELETE RESTRICT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  assigned_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT student_manager_assignment_dates_chk CHECK (
    ended_at IS NULL OR ended_at > started_at
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_primary_manager_per_student
  ON student_manager_assignments(student_id)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS student_manager_assignments_manager_idx
  ON student_manager_assignments(manager_user_id, started_at DESC);
