DO $$ BEGIN
  CREATE TYPE progress_report_type AS ENUM ('INITIAL', 'REQUESTED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS first_lesson_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  session_id UUID NOT NULL UNIQUE REFERENCES live_sessions(id) ON DELETE RESTRICT,
  subject_price_version_id UUID NOT NULL REFERENCES subject_price_versions(id) ON DELETE RESTRICT,
  base_price_minor BIGINT NOT NULL,
  final_price_minor BIGINT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'UAH',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT first_lesson_order_base_price_chk CHECK (base_price_minor >= 0),
  CONSTRAINT first_lesson_order_final_price_chk CHECK (final_price_minor >= 0),
  CONSTRAINT first_lesson_order_discount_chk CHECK (final_price_minor <= base_price_minor)
);

CREATE INDEX IF NOT EXISTS first_lesson_orders_session_idx
  ON first_lesson_orders(session_id);

CREATE TABLE IF NOT EXISTS progress_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  session_id UUID REFERENCES live_sessions(id) ON DELETE RESTRICT,
  report_type progress_report_type NOT NULL,
  strengths TEXT NOT NULL,
  gaps TEXT NOT NULL,
  action_plan TEXT NOT NULL,
  visible_to_parent BOOLEAN NOT NULL DEFAULT true,
  visible_to_student BOOLEAN NOT NULL DEFAULT true,
  created_by_teacher_id UUID NOT NULL REFERENCES teacher_profiles(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS progress_reports_initial_session_uidx
  ON progress_reports(session_id)
  WHERE report_type = 'INITIAL' AND session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS progress_reports_student_subject_idx
  ON progress_reports(student_id, subject_id, created_at DESC);
