-- Explicit lifecycle metadata for operational archive/reactivate flows.
ALTER TABLE families
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT;

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT;

CREATE INDEX IF NOT EXISTS families_archived_at_idx
  ON families(archived_at);

CREATE INDEX IF NOT EXISTS students_archived_at_idx
  ON students(archived_at);

CREATE INDEX IF NOT EXISTS users_email_trgm_idx
  ON users
  USING gin ((email::text) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS parent_profiles_full_name_trgm_idx
  ON parent_profiles
  USING gin ((first_name || ' ' || last_name) gin_trgm_ops);
