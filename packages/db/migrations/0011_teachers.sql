DO $$ BEGIN
  CREATE TYPE teacher_status AS ENUM ('INVITED', 'ACTIVE', 'ON_LEAVE', 'ARCHIVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS teacher_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  zoom_url TEXT,
  status teacher_status NOT NULL DEFAULT 'INVITED',
  started_at DATE,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS teacher_profiles_status_idx ON teacher_profiles(status);
CREATE INDEX IF NOT EXISTS teacher_profiles_name_trgm_idx
  ON teacher_profiles USING gin ((last_name || ' ' || first_name) gin_trgm_ops);
