-- v28: LiqPay payment-provider integration, webhook idempotency and refund ledger.

ALTER TYPE credit_debit_type ADD VALUE IF NOT EXISTS 'PURCHASE_REFUND';

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS provider_status TEXT,
  ADD COLUMN IF NOT EXISTS refunded_minor BIGINT NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE payments
    ADD CONSTRAINT payments_refunded_nonnegative_chk CHECK (refunded_minor >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_refund_status AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS payment_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  amount_minor BIGINT NOT NULL,
  credits_to_revoke INTEGER NOT NULL,
  status payment_refund_status NOT NULL DEFAULT 'PENDING',
  provider TEXT NOT NULL,
  provider_refund_id TEXT,
  provider_status TEXT,
  idempotency_key TEXT,
  reason TEXT,
  requested_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  provider_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT payment_refunds_amount_positive_chk CHECK (amount_minor > 0),
  CONSTRAINT payment_refunds_credits_positive_chk CHECK (credits_to_revoke > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_refunds_idempotency_uidx
  ON payment_refunds(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_refunds_payment_idx
  ON payment_refunds(payment_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payment_provider_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  event_hash TEXT NOT NULL,
  order_id UUID REFERENCES orders(id) ON DELETE RESTRICT,
  provider_payment_id TEXT,
  provider_status TEXT,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  processing_error TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_provider_events_hash_uidx
  ON payment_provider_events(provider, event_hash);
CREATE INDEX IF NOT EXISTS payment_provider_events_order_idx
  ON payment_provider_events(order_id, received_at DESC);

INSERT INTO permissions(code, description)
VALUES ('billing.refund', 'Refund successful online payments and revoke refundable lesson credits')
ON CONFLICT(code) DO UPDATE SET description=EXCLUDED.description;

INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code='billing.refund'
WHERE r.code IN ('ADMIN','MANAGER','SUPPORT_MANAGER','FINANCIER')
ON CONFLICT DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS payments_order_provider_uidx
  ON payments(order_id, provider);

CREATE UNIQUE INDEX IF NOT EXISTS lesson_credit_grants_purchase_topup_uidx
  ON lesson_credit_grants(lesson_topup_id);
