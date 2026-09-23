DO $$ BEGIN
  CREATE TYPE progress_report_request_status AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS progress_report_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  enrollment_id UUID NOT NULL REFERENCES student_subject_enrollments(id) ON DELETE RESTRICT,
  requested_by_parent_id UUID NOT NULL REFERENCES parent_profiles(user_id) ON DELETE RESTRICT,
  target_session_id UUID REFERENCES live_sessions(id) ON DELETE RESTRICT,
  visible_to_student BOOLEAN NOT NULL DEFAULT true,
  status progress_report_request_status NOT NULL DEFAULT 'PENDING',
  report_id UUID UNIQUE REFERENCES progress_reports(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  CONSTRAINT progress_report_request_completion_chk CHECK (
    (status = 'COMPLETED' AND completed_at IS NOT NULL AND report_id IS NOT NULL)
    OR (status <> 'COMPLETED')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS progress_report_requests_one_pending_uidx
  ON progress_report_requests(student_id, subject_id)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS progress_report_requests_teacher_target_idx
  ON progress_report_requests(target_session_id)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS progress_report_requests_enrollment_created_idx
  ON progress_report_requests(enrollment_id, created_at DESC);
