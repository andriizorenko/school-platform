DO $$ BEGIN
  CREATE TYPE promotion_discount_type AS ENUM ('PERCENT', 'FIXED_AMOUNT', 'SPECIAL_PRICE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE promotion_product_type AS ENUM ('REGULAR_LESSONS', 'FIRST_LESSON', 'COURSE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  discount_type promotion_discount_type NOT NULL,
  discount_value BIGINT NOT NULL,
  code TEXT,
  is_automatic BOOLEAN NOT NULL DEFAULT true,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT promotion_dates_chk CHECK(ends_at > starts_at),
  CONSTRAINT promotion_value_chk CHECK(discount_value >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS promotions_code_uidx ON promotions(code) WHERE code IS NOT NULL;

CREATE TABLE IF NOT EXISTS promotion_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id UUID NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  product_type promotion_product_type NOT NULL,
  subject_id UUID REFERENCES subjects(id) ON DELETE RESTRICT,
  course_id UUID REFERENCES courses(id) ON DELETE RESTRICT,
  CONSTRAINT promotion_target_scope_chk CHECK(subject_id IS NOT NULL OR course_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS promotion_targets_promo_idx ON promotion_targets(promotion_id);
