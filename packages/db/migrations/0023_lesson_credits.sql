DO $$ BEGIN
  CREATE TYPE credit_grant_type AS ENUM ('PURCHASE', 'TEACHER_COMPENSATION', 'TRANSFER_IN', 'MANUAL_ADJUSTMENT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE credit_debit_type AS ENUM ('LESSON_COMPLETED', 'NO_SHOW_CHARGED', 'TRANSFER_OUT', 'WRITE_OFF', 'MANUAL_ADJUSTMENT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE credit_reservation_status AS ENUM ('ACTIVE', 'CONSUMED', 'RELEASED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS lesson_credit_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL REFERENCES student_subject_enrollments(id) ON DELETE RESTRICT,
  type credit_grant_type NOT NULL,
  credits_granted INTEGER NOT NULL,
  lesson_topup_id UUID REFERENCES lesson_topups(id) ON DELETE RESTRICT,
  source_transfer_id UUID,
  restricted_teacher_id UUID REFERENCES teacher_profiles(user_id) ON DELETE RESTRICT,
  created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lesson_credit_grant_positive_chk CHECK (credits_granted > 0)
);

CREATE INDEX IF NOT EXISTS lesson_credit_grants_enrollment_idx
  ON lesson_credit_grants(enrollment_id, created_at);

CREATE TABLE IF NOT EXISTS lesson_credit_debits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL REFERENCES student_subject_enrollments(id) ON DELETE RESTRICT,
  type credit_debit_type NOT NULL,
  credits_debited INTEGER NOT NULL,
  session_id UUID REFERENCES live_sessions(id) ON DELETE RESTRICT,
  transfer_id UUID,
  created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lesson_credit_debit_positive_chk CHECK (credits_debited > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS lesson_credit_debits_session_uidx
  ON lesson_credit_debits(session_id)
  WHERE session_id IS NOT NULL AND type IN ('LESSON_COMPLETED', 'NO_SHOW_CHARGED');

CREATE INDEX IF NOT EXISTS lesson_credit_debits_enrollment_idx
  ON lesson_credit_debits(enrollment_id, created_at);

CREATE TABLE IF NOT EXISTS lesson_credit_allocations (
  debit_id UUID NOT NULL REFERENCES lesson_credit_debits(id) ON DELETE RESTRICT,
  grant_id UUID NOT NULL REFERENCES lesson_credit_grants(id) ON DELETE RESTRICT,
  credits INTEGER NOT NULL,
  PRIMARY KEY (debit_id, grant_id),
  CONSTRAINT lesson_credit_allocation_positive_chk CHECK (credits > 0)
);

CREATE INDEX IF NOT EXISTS lesson_credit_allocations_grant_idx
  ON lesson_credit_allocations(grant_id);

CREATE TABLE IF NOT EXISTS session_credit_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL UNIQUE REFERENCES live_sessions(id) ON DELETE RESTRICT,
  enrollment_id UUID NOT NULL REFERENCES student_subject_enrollments(id) ON DELETE RESTRICT,
  credits_reserved INTEGER NOT NULL,
  status credit_reservation_status NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT session_credit_reservation_credits_chk CHECK (credits_reserved IN (1, 2))
);

CREATE INDEX IF NOT EXISTS session_credit_reservations_enrollment_idx
  ON session_credit_reservations(enrollment_id, status);

-- v4 materialized future regular sessions as PAID without financial backing.
-- From M1 onward every PAID regular session must have an ACTIVE credit reservation.
UPDATE live_sessions
SET funding_status = 'BOOKED', updated_at = now()
WHERE session_type = 'REGULAR'
  AND status = 'SCHEDULED'
  AND funding_status = 'PAID';
