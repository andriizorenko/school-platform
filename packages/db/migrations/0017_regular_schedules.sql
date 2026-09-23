CREATE TABLE IF NOT EXISTS regular_schedule_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL REFERENCES student_subject_enrollments(id) ON DELETE RESTRICT,
  effective_from DATE NOT NULL,
  effective_until DATE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT regular_schedule_dates_chk CHECK (
    effective_until IS NULL OR effective_until >= effective_from
  )
);

ALTER TABLE regular_schedule_versions
  DROP CONSTRAINT IF EXISTS regular_schedule_version_no_overlap;

ALTER TABLE regular_schedule_versions
  ADD CONSTRAINT regular_schedule_version_no_overlap
  EXCLUDE USING gist (
    enrollment_id WITH =,
    daterange(
      effective_from,
      COALESCE(effective_until + 1, 'infinity'::date),
      '[)'
    ) WITH &&
  );

CREATE INDEX IF NOT EXISTS regular_schedule_versions_lookup_idx
  ON regular_schedule_versions(enrollment_id, effective_from DESC);

CREATE TABLE IF NOT EXISTS regular_schedule_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_version_id UUID NOT NULL REFERENCES regular_schedule_versions(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL,
  start_time TIME NOT NULL,
  duration_minutes SMALLINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT regular_schedule_slot_day_chk CHECK (day_of_week BETWEEN 1 AND 7),
  CONSTRAINT regular_schedule_slot_duration_chk CHECK (duration_minutes IN (30, 60)),
  CONSTRAINT regular_schedule_slot_uq UNIQUE (schedule_version_id, day_of_week, start_time)
);

CREATE INDEX IF NOT EXISTS regular_schedule_slots_version_idx
  ON regular_schedule_slots(schedule_version_id, day_of_week, start_time);
