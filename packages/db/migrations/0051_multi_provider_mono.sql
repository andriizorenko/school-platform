-- v29: multi-provider checkout with monobank acquiring and webhook ordering protection.

ALTER TABLE lesson_checkout_intents
  ADD COLUMN IF NOT EXISTS payment_provider TEXT;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS provider_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_checkout_url TEXT;

ALTER TABLE payment_provider_events
  ADD COLUMN IF NOT EXISTS provider_updated_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_payment_uidx
  ON payments(provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payment_provider_events_provider_updated_idx
  ON payment_provider_events(provider, provider_updated_at DESC)
  WHERE provider_updated_at IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE lesson_checkout_intents
    ADD CONSTRAINT lesson_checkout_payment_provider_chk
    CHECK (payment_provider IS NULL OR payment_provider IN ('LIQPAY','MONO'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
