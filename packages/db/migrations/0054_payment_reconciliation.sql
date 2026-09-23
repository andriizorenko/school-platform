ALTER TABLE payment_provider_events
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciled_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS reconciliation_note text;

CREATE INDEX IF NOT EXISTS payment_provider_events_reconciliation_idx
  ON payment_provider_events(received_at DESC)
  WHERE processing_error LIKE '%RECONCILIATION%' AND reconciled_at IS NULL;

INSERT INTO permissions (code, description)
VALUES ('billing.reconcile', 'Review and resolve payment-provider reconciliation events')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'billing.reconcile'
WHERE r.code IN ('ADMIN', 'MANAGER', 'SUPPORT_MANAGER', 'FINANCIER')
ON CONFLICT DO NOTHING;
