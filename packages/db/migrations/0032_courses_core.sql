DO $$ BEGIN
  CREATE TYPE course_status AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE course_block_type AS ENUM ('TEXT', 'PDF', 'TEST');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE course_access_type AS ENUM ('DURATION', 'FIXED_EXPIRY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE course_license_status AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE course_lesson_progress_status AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE asset_type AS ENUM ('IMAGE', 'PDF', 'PDF_PAGE', 'COURSE_COVER', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE asset_status AS ENUM ('UPLOADING', 'PROCESSING', 'READY', 'FAILED', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type asset_type NOT NULL,
  status asset_status NOT NULL DEFAULT 'UPLOADING',
  storage_key TEXT NOT NULL UNIQUE,
  original_filename TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  checksum TEXT,
  uploaded_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID REFERENCES subjects(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  cover_asset_id UUID REFERENCES assets(id) ON DELETE RESTRICT,
  status course_status NOT NULL DEFAULT 'DRAFT',
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  published_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS courses_status_idx ON courses(status, created_at DESC);

CREATE TABLE IF NOT EXISTS course_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  description TEXT,
  position INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(course_id, position)
);

CREATE TABLE IF NOT EXISTS course_lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID NOT NULL REFERENCES course_modules(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  description TEXT,
  position INTEGER NOT NULL,
  estimated_minutes INTEGER,
  is_published BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(module_id, position)
);

CREATE TABLE IF NOT EXISTS course_lesson_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id UUID NOT NULL REFERENCES course_lessons(id) ON DELETE RESTRICT,
  type course_block_type NOT NULL,
  position INTEGER NOT NULL,
  content JSONB,
  asset_id UUID REFERENCES assets(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(lesson_id, position)
);

CREATE TABLE IF NOT EXISTS course_access_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  access_type course_access_type NOT NULL,
  duration_months INTEGER,
  fixed_expiry_date DATE,
  price_minor BIGINT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'UAH',
  explanations_enabled BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT course_access_price_chk CHECK(price_minor >= 0),
  CONSTRAINT course_access_shape_chk CHECK(
    (access_type='DURATION' AND duration_months IS NOT NULL AND duration_months > 0 AND fixed_expiry_date IS NULL)
    OR (access_type='FIXED_EXPIRY' AND fixed_expiry_date IS NOT NULL AND duration_months IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS course_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  access_plan_id UUID NOT NULL REFERENCES course_access_plans(id) ON DELETE RESTRICT,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  base_price_minor BIGINT NOT NULL,
  final_price_minor BIGINT NOT NULL,
  access_type_snapshot course_access_type NOT NULL,
  duration_months_snapshot INTEGER,
  fixed_expiry_snapshot DATE,
  explanations_enabled_snapshot BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS course_licenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  purchase_id UUID NOT NULL REFERENCES course_purchases(id) ON DELETE RESTRICT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status course_license_status NOT NULL DEFAULT 'ACTIVE',
  explanations_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT course_license_dates_chk CHECK(ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS course_licenses_family_idx ON course_licenses(family_id, status, ends_at);

CREATE TABLE IF NOT EXISTS course_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id UUID NOT NULL REFERENCES course_licenses(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  UNIQUE(license_id, student_id)
);
CREATE INDEX IF NOT EXISTS course_enrollments_student_idx ON course_enrollments(student_id, granted_at DESC);

CREATE TABLE IF NOT EXISTS course_lesson_progress (
  enrollment_id UUID NOT NULL REFERENCES course_enrollments(id) ON DELETE RESTRICT,
  lesson_id UUID NOT NULL REFERENCES course_lessons(id) ON DELETE RESTRICT,
  status course_lesson_progress_status NOT NULL DEFAULT 'NOT_STARTED',
  first_started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_opened_at TIMESTAMPTZ,
  PRIMARY KEY(enrollment_id, lesson_id)
);
