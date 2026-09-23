-- v25: subject pricing, promotions and provider-agnostic parent lesson checkout.

ALTER TABLE promotion_targets
  DROP CONSTRAINT IF EXISTS promotion_target_scope_chk;

ALTER TABLE promotion_targets
  ADD CONSTRAINT promotion_target_scope_chk
  CHECK (NOT (subject_id IS NOT NULL AND course_id IS NOT NULL));

DROP INDEX IF EXISTS promotions_code_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS promotions_code_ci_uidx
  ON promotions (upper(code))
  WHERE code IS NOT NULL;

ALTER TABLE promotions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS promotions_active_window_idx
  ON promotions(is_active, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS promotion_targets_subject_idx
  ON promotion_targets(product_type, subject_id)
  WHERE subject_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS promotion_targets_course_idx
  ON promotion_targets(product_type, course_id)
  WHERE course_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS order_promotions (
  order_id UUID PRIMARY KEY REFERENCES orders(id) ON DELETE RESTRICT,
  promotion_id UUID REFERENCES promotions(id) ON DELETE RESTRICT,
  promotion_name_snapshot TEXT NOT NULL,
  discount_type promotion_discount_type NOT NULL,
  discount_value BIGINT NOT NULL,
  discount_minor BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT order_promotions_discount_chk CHECK (discount_minor >= 0)
);

CREATE INDEX IF NOT EXISTS order_promotions_promotion_idx
  ON order_promotions(promotion_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lesson_checkout_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  enrollment_id UUID NOT NULL REFERENCES student_subject_enrollments(id) ON DELETE RESTRICT,
  subject_price_version_id UUID NOT NULL REFERENCES subject_price_versions(id) ON DELETE RESTRICT,
  lesson_units INTEGER NOT NULL,
  credits_to_grant INTEGER NOT NULL,
  base_unit_price_minor BIGINT NOT NULL,
  base_total_minor BIGINT NOT NULL,
  discount_minor BIGINT NOT NULL DEFAULT 0,
  final_total_minor BIGINT NOT NULL,
  promotion_id UUID REFERENCES promotions(id) ON DELETE RESTRICT,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lesson_checkout_units_chk CHECK (lesson_units > 0),
  CONSTRAINT lesson_checkout_credits_chk CHECK (credits_to_grant > 0),
  CONSTRAINT lesson_checkout_amounts_chk CHECK (
    base_unit_price_minor >= 0 AND base_total_minor >= 0 AND discount_minor >= 0 AND final_total_minor >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS lesson_checkout_idempotency_uidx
  ON lesson_checkout_intents(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS lesson_checkout_enrollment_idx
  ON lesson_checkout_intents(enrollment_id, created_at DESC);

INSERT INTO permissions(code, description)
VALUES ('billing.checkout', 'Create customer checkout intents for regular lesson purchases')
ON CONFLICT(code) DO UPDATE SET description=EXCLUDED.description;

INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code='billing.checkout'
WHERE r.code IN ('ADMIN','MANAGER','SUPPORT_MANAGER','PARENT')
ON CONFLICT DO NOTHING;
