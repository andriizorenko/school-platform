INSERT INTO notification_event_types (code, user_configurable, default_enabled, description)
VALUES
  ('SUBSTITUTE_ASSIGNED', true, true, 'A substitute teacher was assigned to a lesson')
ON CONFLICT (code) DO NOTHING;
