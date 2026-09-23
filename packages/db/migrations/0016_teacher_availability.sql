DO $$ BEGIN
  CREATE TYPE availability_season AS ENUM ('SCHOOL_YEAR', 'SUMMER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS teacher_availability_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES teacher_profiles(user_id) ON DELETE RESTRICT,
  season availability_season NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT teacher_availability_template_uq UNIQUE (teacher_id, season)
);

CREATE TABLE IF NOT EXISTS teacher_availability_windows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES teacher_availability_templates(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT availability_window_day_chk CHECK (day_of_week BETWEEN 1 AND 7),
  CONSTRAINT availability_window_time_chk CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS teacher_availability_windows_template_idx
  ON teacher_availability_windows(template_id, day_of_week, start_time);

CREATE TABLE IF NOT EXISTS teacher_availability_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES teacher_profiles(user_id) ON DELETE RESTRICT,
  exception_date DATE NOT NULL,
  is_unavailable_all_day BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT teacher_availability_exception_uq UNIQUE (teacher_id, exception_date)
);

CREATE TABLE IF NOT EXISTS teacher_availability_exception_windows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exception_id UUID NOT NULL REFERENCES teacher_availability_exceptions(id) ON DELETE CASCADE,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT availability_exception_window_time_chk CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS teacher_availability_exception_windows_idx
  ON teacher_availability_exception_windows(exception_id, start_time);

DO $$ BEGIN
  CREATE TYPE vacation_request_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS teacher_vacation_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES teacher_profiles(user_id) ON DELETE RESTRICT,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  comment TEXT,
  status vacation_request_status NOT NULL DEFAULT 'PENDING',
  reviewed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT teacher_vacation_dates_chk CHECK (ends_on >= starts_on)
);

CREATE INDEX IF NOT EXISTS teacher_vacation_requests_teacher_idx
  ON teacher_vacation_requests(teacher_id, starts_on, ends_on, status);
