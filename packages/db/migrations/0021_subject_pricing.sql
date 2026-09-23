CREATE TABLE IF NOT EXISTS subject_price_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  regular_60_price_minor BIGINT NOT NULL,
  first_lesson_price_minor BIGINT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'UAH',
  effective_from DATE NOT NULL,
  effective_until DATE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT subject_price_regular_nonnegative_chk CHECK (regular_60_price_minor >= 0),
  CONSTRAINT subject_price_first_nonnegative_chk CHECK (first_lesson_price_minor >= 0),
  CONSTRAINT subject_price_dates_chk CHECK (effective_until IS NULL OR effective_until >= effective_from)
);

ALTER TABLE subject_price_versions
  DROP CONSTRAINT IF EXISTS subject_price_no_overlap;

ALTER TABLE subject_price_versions
  ADD CONSTRAINT subject_price_no_overlap
  EXCLUDE USING gist (
    subject_id WITH =,
    daterange(
      effective_from,
      COALESCE(effective_until + 1, 'infinity'::date),
      '[)'
    ) WITH &&
  );

CREATE INDEX IF NOT EXISTS subject_price_versions_lookup_idx
  ON subject_price_versions(subject_id, effective_from DESC);
