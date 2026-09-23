DO $$ BEGIN
  CREATE TYPE user_status AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'ARCHIVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email CITEXT NOT NULL UNIQUE,
  password_hash TEXT,
  status user_status NOT NULL DEFAULT 'PENDING',
  email_verified_at TIMESTAMPTZ,
  suspended_at TIMESTAMPTZ,
  suspended_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  suspension_reason TEXT,
  archived_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_suspended_state_chk CHECK (
    status <> 'SUSPENDED' OR suspended_at IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS users_status_idx ON users(status);
