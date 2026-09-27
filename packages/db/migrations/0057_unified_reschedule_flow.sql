ALTER TYPE reschedule_reason ADD VALUE IF NOT EXISTS 'STUDENT_ADVANCE_NOTICE';
ALTER TYPE reschedule_reason ADD VALUE IF NOT EXISTS 'STUDENT_LATE_NO_NOTICE';
ALTER TYPE reschedule_reason ADD VALUE IF NOT EXISTS 'STUDENT_TECHNICAL';
ALTER TYPE reschedule_reason ADD VALUE IF NOT EXISTS 'TEACHER_ADVANCE_NOTICE';
ALTER TYPE reschedule_reason ADD VALUE IF NOT EXISTS 'TEACHER_LATE_CANCELLATION';

INSERT INTO school_settings(
  key, value, description, category, value_type, unit,
  min_numeric, max_numeric, is_critical, sort_order
)
VALUES (
  'lesson_late_notice_cutoff_minutes',
  '120',
  'Minutes before lesson start that separate advance notice from late or missing notice',
  'SCHEDULING',
  'INTEGER',
  'хв',
  0,
  1440,
  true,
  15
)
ON CONFLICT(key) DO NOTHING;
