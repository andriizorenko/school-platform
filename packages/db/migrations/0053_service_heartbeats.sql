CREATE TABLE IF NOT EXISTS service_heartbeats (
  service_name TEXT PRIMARY KEY,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  release_sha TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS service_heartbeats_last_seen_at_idx
  ON service_heartbeats(last_seen_at);
