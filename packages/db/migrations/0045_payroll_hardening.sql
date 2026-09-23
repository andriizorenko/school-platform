INSERT INTO school_settings(key, value, description)
VALUES
  ('payroll_anchor_date', '"2026-09-07"', 'Start date of the first 14-day payroll calculation period'),
  ('payroll_period_days', '14', 'Payroll calculation period length in calendar days'),
  ('payroll_payout_window_days', '3', 'Number of calendar days in the payout window after each calculation period')
ON CONFLICT (key) DO NOTHING;

INSERT INTO permissions(code, description)
VALUES ('payroll.operations.view', 'View school-wide payroll operations')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'payroll.operations.view'
WHERE r.code IN ('ADMIN', 'FINANCIER')
ON CONFLICT DO NOTHING;

ALTER TABLE payroll_periods
  ADD COLUMN IF NOT EXISTS calculated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS payroll_accruals_unsettled_lookup_idx
  ON payroll_accruals(earned_for_date, teacher_id, created_at);

CREATE INDEX IF NOT EXISTS payroll_periods_status_dates_idx
  ON payroll_periods(status, period_start DESC, period_end DESC);

CREATE INDEX IF NOT EXISTS teacher_payout_items_payout_idx
  ON teacher_payout_items(payout_id, accrual_id);

CREATE OR REPLACE FUNCTION protect_paid_teacher_payout()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'PAID' THEN
      RAISE EXCEPTION 'Paid teacher payouts are immutable';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'PAID' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Paid teacher payouts are immutable';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_protect_paid_teacher_payout_update ON teacher_payouts;
CREATE TRIGGER trg_protect_paid_teacher_payout_update
BEFORE UPDATE ON teacher_payouts
FOR EACH ROW EXECUTE FUNCTION protect_paid_teacher_payout();

DROP TRIGGER IF EXISTS trg_protect_paid_teacher_payout_delete ON teacher_payouts;
CREATE TRIGGER trg_protect_paid_teacher_payout_delete
BEFORE DELETE ON teacher_payouts
FOR EACH ROW EXECUTE FUNCTION protect_paid_teacher_payout();

CREATE OR REPLACE FUNCTION protect_paid_teacher_payout_items()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  payout_uuid UUID;
  payout_state teacher_payout_status;
BEGIN
  payout_uuid := CASE WHEN TG_OP = 'INSERT' THEN NEW.payout_id ELSE OLD.payout_id END;
  SELECT status INTO payout_state FROM teacher_payouts WHERE id = payout_uuid;

  IF payout_state = 'PAID' THEN
    RAISE EXCEPTION 'Items of a paid teacher payout are immutable';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_protect_paid_teacher_payout_items_insert ON teacher_payout_items;
CREATE TRIGGER trg_protect_paid_teacher_payout_items_insert
BEFORE INSERT ON teacher_payout_items
FOR EACH ROW EXECUTE FUNCTION protect_paid_teacher_payout_items();

DROP TRIGGER IF EXISTS trg_protect_paid_teacher_payout_items_update ON teacher_payout_items;
CREATE TRIGGER trg_protect_paid_teacher_payout_items_update
BEFORE UPDATE ON teacher_payout_items
FOR EACH ROW EXECUTE FUNCTION protect_paid_teacher_payout_items();

DROP TRIGGER IF EXISTS trg_protect_paid_teacher_payout_items_delete ON teacher_payout_items;
CREATE TRIGGER trg_protect_paid_teacher_payout_items_delete
BEFORE DELETE ON teacher_payout_items
FOR EACH ROW EXECUTE FUNCTION protect_paid_teacher_payout_items();
