CREATE TABLE IF NOT EXISTS teacher_rate_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_subject_id UUID NOT NULL REFERENCES teacher_subjects(id) ON DELETE RESTRICT,
  rate_60_minor BIGINT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'UAH',
  effective_from DATE NOT NULL,
  effective_until DATE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT teacher_rate_amount_chk CHECK (rate_60_minor >= 0),
  CONSTRAINT teacher_rate_dates_chk CHECK (
    effective_until IS NULL OR effective_until >= effective_from
  )
);

ALTER TABLE teacher_rate_versions
  DROP CONSTRAINT IF EXISTS teacher_rate_no_overlap;

ALTER TABLE teacher_rate_versions
  ADD CONSTRAINT teacher_rate_no_overlap
  EXCLUDE USING gist (
    teacher_subject_id WITH =,
    daterange(
      effective_from,
      COALESCE(effective_until + 1, 'infinity'::date),
      '[)'
    ) WITH &&
  );

CREATE INDEX IF NOT EXISTS teacher_rate_versions_lookup_idx
  ON teacher_rate_versions(teacher_subject_id, effective_from DESC);
