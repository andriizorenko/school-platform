INSERT INTO permissions (code, description)
VALUES ('lesson.outcome.undo', 'Undo a recorded lesson outcome')
ON CONFLICT (code) DO UPDATE SET description=EXCLUDED.description;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code='lesson.outcome.undo'
WHERE r.code IN ('ADMIN','MANAGER','SUPPORT_MANAGER','TEACHER')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS lesson_outcome_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES live_sessions(id) ON DELETE RESTRICT,
  previous_status live_session_status NOT NULL,
  incident_id UUID REFERENCES session_incidents(id) ON DELETE SET NULL,
  incident_type session_incident_type,
  incident_outcome session_incident_outcome,
  reason TEXT NOT NULL,
  before_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  corrected_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lesson_outcome_corrections_session_idx
  ON lesson_outcome_corrections(session_id, created_at);
