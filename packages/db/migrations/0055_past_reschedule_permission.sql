INSERT INTO permissions (code, description)
VALUES ('lesson.reschedule.past', 'Reschedule lessons to a historical time')
ON CONFLICT (code) DO UPDATE SET description=EXCLUDED.description;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code='lesson.reschedule.past'
WHERE r.code='ADMIN'
ON CONFLICT DO NOTHING;
