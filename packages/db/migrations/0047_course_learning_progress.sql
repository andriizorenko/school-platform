CREATE TABLE IF NOT EXISTS mistake_practice_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mistake_id UUID NOT NULL REFERENCES student_mistakes(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  course_enrollment_id UUID REFERENCES course_enrollments(id) ON DELETE RESTRICT,
  question_template_id UUID NOT NULL REFERENCES question_templates(id) ON DELETE RESTRICT,
  generated_prompt JSONB NOT NULL,
  generated_answer_definition JSONB NOT NULL,
  student_answer JSONB,
  is_correct BOOLEAN,
  analogous BOOLEAN NOT NULL DEFAULT true,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at TIMESTAMPTZ,
  CONSTRAINT mistake_practice_answer_shape_chk CHECK (
    (answered_at IS NULL AND is_correct IS NULL)
    OR (answered_at IS NOT NULL AND is_correct IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS mistake_practice_student_idx
  ON mistake_practice_attempts(student_id, started_at DESC);
CREATE INDEX IF NOT EXISTS mistake_practice_mistake_idx
  ON mistake_practice_attempts(mistake_id, started_at DESC);
CREATE INDEX IF NOT EXISTS mistake_practice_enrollment_idx
  ON mistake_practice_attempts(course_enrollment_id, started_at DESC)
  WHERE course_enrollment_id IS NOT NULL;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS source_course_id UUID REFERENCES courses(id) ON DELETE RESTRICT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source_course_enrollment_id UUID REFERENCES course_enrollments(id) ON DELETE RESTRICT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source_test_attempt_id UUID REFERENCES test_attempts(id) ON DELETE RESTRICT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source_topic_id UUID REFERENCES subject_topics(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS leads_course_source_idx
  ON leads(source_course_enrollment_id, source_topic_id, status, created_at DESC)
  WHERE source='COURSE';

CREATE UNIQUE INDEX IF NOT EXISTS leads_open_course_enrollment_topic_unique
  ON leads(
    source_course_enrollment_id,
    COALESCE(source_topic_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE source='COURSE' AND status IN ('NEW','CONTACTED','FIRST_LESSON');

CREATE INDEX IF NOT EXISTS test_attempts_course_enrollment_completed_idx
  ON test_attempts(course_enrollment_id, completed_at DESC)
  WHERE course_enrollment_id IS NOT NULL;
