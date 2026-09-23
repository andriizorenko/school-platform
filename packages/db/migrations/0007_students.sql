CREATE TABLE IF NOT EXISTS students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  user_id UUID UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  birth_date DATE,
  grade_level SMALLINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  CONSTRAINT students_grade_level_chk CHECK (
    grade_level IS NULL OR grade_level BETWEEN 1 AND 12
  )
);

CREATE INDEX IF NOT EXISTS students_family_idx
  ON students(family_id);

CREATE INDEX IF NOT EXISTS students_user_idx
  ON students(user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS students_name_trgm_idx
  ON students
  USING gin ((last_name || ' ' || first_name) gin_trgm_ops);
