DO $$ BEGIN
  CREATE TYPE order_status AS ENUM ('DRAFT', 'PENDING_PAYMENT', 'PAID', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE order_source AS ENUM ('ONLINE', 'MANAGER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM ('CARD', 'BANK_TRANSFER', 'CASH', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  source order_source NOT NULL,
  status order_status NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'UAH',
  subtotal_minor BIGINT NOT NULL,
  discount_minor BIGINT NOT NULL DEFAULT 0,
  total_minor BIGINT NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ,
  CONSTRAINT order_subtotal_nonnegative_chk CHECK (subtotal_minor >= 0),
  CONSTRAINT order_discount_nonnegative_chk CHECK (discount_minor >= 0),
  CONSTRAINT order_total_nonnegative_chk CHECK (total_minor >= 0)
);

CREATE INDEX IF NOT EXISTS orders_family_idx ON orders(family_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  amount_minor BIGINT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'UAH',
  method payment_method NOT NULL,
  status payment_status NOT NULL,
  provider TEXT,
  provider_payment_id TEXT,
  recorded_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payment_amount_nonnegative_chk CHECK (amount_minor >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_payment_uidx
  ON payments(provider, provider_payment_id)
  WHERE provider IS NOT NULL AND provider_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payments_order_idx ON payments(order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lesson_topups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  enrollment_id UUID NOT NULL REFERENCES student_subject_enrollments(id) ON DELETE RESTRICT,
  subject_price_version_id UUID REFERENCES subject_price_versions(id) ON DELETE RESTRICT,
  lesson_units INTEGER NOT NULL,
  credits_granted INTEGER NOT NULL,
  base_unit_price_minor BIGINT NOT NULL,
  final_total_minor BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lesson_topup_units_chk CHECK (lesson_units > 0),
  CONSTRAINT lesson_topup_credits_chk CHECK (credits_granted > 0),
  CONSTRAINT lesson_topup_price_chk CHECK (base_unit_price_minor >= 0 AND final_total_minor >= 0)
);

CREATE INDEX IF NOT EXISTS lesson_topups_enrollment_idx
  ON lesson_topups(enrollment_id, created_at DESC);
