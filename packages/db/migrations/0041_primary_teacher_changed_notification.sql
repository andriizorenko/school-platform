INSERT INTO notification_event_types (code, user_configurable, default_enabled, description)
VALUES ('PRIMARY_TEACHER_CHANGED', true, true, 'Primary tutoring teacher changed')
ON CONFLICT (code) DO NOTHING;

INSERT INTO notification_event_roles(event_type, role_code)
VALUES
  ('PRIMARY_TEACHER_CHANGED','PARENT'),
  ('PRIMARY_TEACHER_CHANGED','STUDENT'),
  ('PRIMARY_TEACHER_CHANGED','TEACHER')
ON CONFLICT DO NOTHING;
