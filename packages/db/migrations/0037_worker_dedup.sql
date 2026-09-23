CREATE TABLE IF NOT EXISTS worker_dedup_keys (
  dedup_key TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS worker_dedup_created_idx ON worker_dedup_keys(created_at);
