DO $$ BEGIN
  CREATE TYPE lead_status AS ENUM ('NEW', 'CONTACTED', 'FIRST_LESSON', 'CONVERTED', 'LOST');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE lead_source AS ENUM ('WEBSITE_SIGNUP', 'CALLBACK', 'MANUAL', 'COURSE', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS school_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO school_settings(key, value, description)
VALUES
  ('parent_reschedule_cutoff_minutes', '120', 'Minimum minutes before a lesson when a parent may reschedule'),
  ('teacher_mark_deadline_hours', '48', 'Teacher lesson marking deadline'),
  ('reservation_tail_days', '14', 'Regular schedule reservation tail after paid horizon'),
  ('online_min_lesson_units', '10', 'Minimum regular lesson purchase online'),
  ('low_balance_lesson_units', '3', 'Low balance reminder threshold'),
  ('policy_clean_streak_reset', '5', 'Normal lessons required to reset one strike'),
  ('report_request_min_lessons', '5', 'Minimum completed lessons between progress report requests'),
  ('school_year_start', '"09-01"', 'School-year availability start month-day'),
  ('school_year_end', '"05-31"', 'School-year availability end month-day'),
  ('first_lesson_teacher_pay_minor', '15000', 'Teacher pay for a conducted first lesson')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source lead_source NOT NULL,
  status lead_status NOT NULL DEFAULT 'NEW',
  parent_first_name TEXT,
  parent_last_name TEXT,
  student_first_name TEXT,
  student_last_name TEXT,
  phone TEXT NOT NULL,
  email CITEXT,
  telegram TEXT,
  subject_id UUID REFERENCES subjects(id) ON DELETE RESTRICT,
  grade_level SMALLINT,
  desired_schedule TEXT,
  learning_goal TEXT,
  teacher_preference TEXT,
  create_student_account BOOLEAN,
  primary_manager_id UUID REFERENCES staff_profiles(user_id) ON DELETE RESTRICT,
  converted_family_id UUID REFERENCES families(id) ON DELETE RESTRICT,
  converted_student_id UUID REFERENCES students(id) ON DELETE RESTRICT,
  created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT leads_grade_chk CHECK (grade_level IS NULL OR grade_level BETWEEN 1 AND 12)
);
CREATE INDEX IF NOT EXISTS leads_status_created_idx ON leads(status, created_at DESC);
CREATE INDEX IF NOT EXISTS leads_manager_idx ON leads(primary_manager_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS leads_phone_idx ON leads(phone);

DO $$ BEGIN
  CREATE TYPE teacher_application_status AS ENUM ('NEW', 'REVIEWING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS teacher_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email CITEXT NOT NULL,
  phone TEXT NOT NULL,
  telegram TEXT,
  education TEXT,
  experience TEXT,
  grades_worked TEXT,
  exam_experience TEXT,
  approximate_hours TEXT,
  status teacher_application_status NOT NULL DEFAULT 'NEW',
  reviewed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS teacher_applications_status_idx ON teacher_applications(status, created_at DESC);

CREATE TABLE IF NOT EXISTS teacher_application_subjects (
  application_id UUID NOT NULL REFERENCES teacher_applications(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  PRIMARY KEY (application_id, subject_id)
);
