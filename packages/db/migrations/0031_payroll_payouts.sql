DO $$ BEGIN
  CREATE TYPE payroll_period_status AS ENUM ('OPEN', 'CALCULATED', 'PAYING', 'PAID');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE teacher_payout_status AS ENUM ('PENDING', 'READY', 'PAID');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS payroll_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  payout_window_start DATE NOT NULL,
  payout_window_end DATE NOT NULL,
  status payroll_period_status NOT NULL DEFAULT 'OPEN',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (period_start, period_end),
  CONSTRAINT payroll_period_dates_chk CHECK (period_end >= period_start AND payout_window_start > period_end AND payout_window_end >= payout_window_start)
);

CREATE TABLE IF NOT EXISTS payroll_accrual_settlements (
  accrual_id UUID PRIMARY KEY REFERENCES payroll_accruals(id) ON DELETE RESTRICT,
  payroll_period_id UUID NOT NULL REFERENCES payroll_periods(id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payroll_settlements_period_idx ON payroll_accrual_settlements(payroll_period_id);

CREATE TABLE IF NOT EXISTS teacher_payout_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES teacher_profiles(user_id) ON DELETE RESTRICT,
  destination_type TEXT NOT NULL,
  details_encrypted TEXT NOT NULL,
  masked_display TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS teacher_payout_one_active_detail_uidx ON teacher_payout_details(teacher_id) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS teacher_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_period_id UUID NOT NULL REFERENCES payroll_periods(id) ON DELETE RESTRICT,
  teacher_id UUID NOT NULL REFERENCES teacher_profiles(user_id) ON DELETE RESTRICT,
  amount_snapshot_minor BIGINT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'UAH',
  payout_destination_snapshot_encrypted TEXT,
  payout_destination_masked TEXT,
  status teacher_payout_status NOT NULL DEFAULT 'PENDING',
  confirmed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (payroll_period_id, teacher_id),
  CONSTRAINT teacher_payout_amount_chk CHECK (amount_snapshot_minor >= 0)
);

CREATE TABLE IF NOT EXISTS teacher_payout_items (
  payout_id UUID NOT NULL REFERENCES teacher_payouts(id) ON DELETE RESTRICT,
  accrual_id UUID NOT NULL UNIQUE REFERENCES payroll_accruals(id) ON DELETE RESTRICT,
  PRIMARY KEY (payout_id, accrual_id)
);
CREATE INDEX IF NOT EXISTS teacher_payouts_period_status_idx ON teacher_payouts(payroll_period_id, status);
CREATE INDEX IF NOT EXISTS teacher_payouts_teacher_idx ON teacher_payouts(teacher_id, created_at DESC);
