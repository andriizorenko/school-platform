ALTER TABLE course_modules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE course_lesson_blocks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE course_access_plans ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE tests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE question_templates ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE assets ADD COLUMN IF NOT EXISTS processing_error TEXT;

CREATE TABLE IF NOT EXISTS pdf_processed_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  page_number INTEGER NOT NULL,
  page_asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  width INTEGER,
  height INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source_asset_id, page_number),
  UNIQUE(page_asset_id),
  CHECK(page_number > 0),
  CHECK(width IS NULL OR width > 0),
  CHECK(height IS NULL OR height > 0)
);

CREATE INDEX IF NOT EXISTS pdf_processed_pages_source_idx ON pdf_processed_pages(source_asset_id, page_number);
CREATE INDEX IF NOT EXISTS course_blocks_lesson_position_idx ON course_lesson_blocks(lesson_id, position);
CREATE INDEX IF NOT EXISTS course_lessons_module_position_idx ON course_lessons(module_id, position);
CREATE INDEX IF NOT EXISTS course_modules_course_position_idx ON course_modules(course_id, position);
CREATE INDEX IF NOT EXISTS test_questions_test_position_idx ON test_questions(test_id, position);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='course_lesson_blocks_shape_chk'
  ) THEN
    ALTER TABLE course_lesson_blocks
      ADD CONSTRAINT course_lesson_blocks_shape_chk CHECK (
        (type='TEXT' AND content IS NOT NULL AND asset_id IS NULL AND test_id IS NULL)
        OR (type='PDF' AND asset_id IS NOT NULL AND test_id IS NULL)
        OR (type='TEST' AND test_id IS NOT NULL AND asset_id IS NULL)
      ) NOT VALID;
  END IF;
END $$;

INSERT INTO school_settings(key,value)
VALUES
  ('course_low_score_threshold_percent','40'::jsonb),
  ('course_pdf_max_size_mb','30'::jsonb)
ON CONFLICT(key) DO NOTHING;
