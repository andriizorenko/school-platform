DO $$ BEGIN
  CREATE TYPE payroll_accrual_type AS ENUM ('REGULAR_60', 'REGULAR_30', 'FIRST_LESSON', 'PAID_STUDENT_NO_SHOW', 'COMPENSATION', 'ADJUSTMENT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS payroll_accruals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES teacher_profiles(user_id) ON DELETE RESTRICT,
  subject_id UUID REFERENCES subjects(id) ON DELETE RESTRICT,
  session_id UUID REFERENCES live_sessions(id) ON DELETE RESTRICT,
  type payroll_accrual_type NOT NULL,
  earned_for_date DATE NOT NULL,
  rate_60_snapshot_minor BIGINT,
  amount_minor BIGINT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'UAH',
  compensation_source_teacher_id UUID REFERENCES teacher_profiles(user_id) ON DELETE RESTRICT,
  reason TEXT,
  created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payroll_accrual_amount_nonnegative_chk CHECK (amount_minor >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS payroll_accruals_session_uidx
  ON payroll_accruals(session_id)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payroll_accruals_teacher_date_idx
  ON payroll_accruals(teacher_id, earned_for_date, created_at);
