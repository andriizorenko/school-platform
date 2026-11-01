ALTER TABLE users ADD COLUMN IF NOT EXISTS contact_phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_username TEXT;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS refusal_reason TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS first_lesson_session_id UUID REFERENCES live_sessions(id) ON DELETE RESTRICT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS converted_enrollment_id UUID REFERENCES student_subject_enrollments(id) ON DELETE RESTRICT;
