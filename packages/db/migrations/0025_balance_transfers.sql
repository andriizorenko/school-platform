CREATE TABLE IF NOT EXISTS lesson_credit_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_enrollment_id UUID NOT NULL REFERENCES student_subject_enrollments(id) ON DELETE RESTRICT,
  to_enrollment_id UUID NOT NULL REFERENCES student_subject_enrollments(id) ON DELETE RESTRICT,
  credits INTEGER NOT NULL,
  requested_by_parent BOOLEAN NOT NULL DEFAULT true,
  processed_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lesson_credit_transfer_positive_chk CHECK (credits > 0),
  CONSTRAINT lesson_credit_transfer_different_enrollments_chk CHECK (from_enrollment_id <> to_enrollment_id)
);

CREATE INDEX IF NOT EXISTS lesson_credit_transfers_from_idx
  ON lesson_credit_transfers(from_enrollment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS lesson_credit_transfers_to_idx
  ON lesson_credit_transfers(to_enrollment_id, created_at DESC);

DO $$ BEGIN
  ALTER TABLE lesson_credit_grants
    ADD CONSTRAINT lesson_credit_grants_source_transfer_fk
    FOREIGN KEY (source_transfer_id) REFERENCES lesson_credit_transfers(id) ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE lesson_credit_debits
    ADD CONSTRAINT lesson_credit_debits_transfer_fk
    FOREIGN KEY (transfer_id) REFERENCES lesson_credit_transfers(id) ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
