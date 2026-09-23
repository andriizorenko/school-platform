-- Read-optimized indexes for manager/admin student and family history workspaces.
CREATE INDEX IF NOT EXISTS orders_family_created_idx
  ON orders(family_id, created_at DESC);

CREATE INDEX IF NOT EXISTS teacher_assignments_enrollment_history_idx
  ON teacher_assignments(enrollment_id, started_at DESC);

CREATE INDEX IF NOT EXISTS regular_schedule_versions_enrollment_history_idx
  ON regular_schedule_versions(enrollment_id, effective_from DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS student_manager_assignments_student_history_idx
  ON student_manager_assignments(student_id, started_at DESC);

CREATE INDEX IF NOT EXISTS live_sessions_student_history_idx
  ON live_sessions(student_id, starts_at DESC);
