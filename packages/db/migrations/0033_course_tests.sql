DO $$ BEGIN
  CREATE TYPE course_test_type AS ENUM ('MINI', 'KNOWLEDGE_CHECK');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE question_template_type AS ENUM ('STATIC', 'GENERATED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE test_attempt_status AS ENUM ('IN_PROGRESS', 'COMPLETED', 'EXPIRED', 'ABANDONED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE mistake_status AS ENUM ('ACTIVE', 'CORRECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS subject_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  parent_topic_id UUID REFERENCES subject_topics(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subject_topics_subject_idx ON subject_topics(subject_id, parent_topic_id);

CREATE TABLE IF NOT EXISTS tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  type course_test_type NOT NULL,
  time_limit_seconds INTEGER,
  low_score_threshold_percent SMALLINT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tests_time_chk CHECK(time_limit_seconds IS NULL OR time_limit_seconds > 0),
  CONSTRAINT tests_threshold_chk CHECK(low_score_threshold_percent IS NULL OR low_score_threshold_percent BETWEEN 0 AND 100)
);

CREATE TABLE IF NOT EXISTS question_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type question_template_type NOT NULL,
  topic_id UUID REFERENCES subject_topics(id) ON DELETE RESTRICT,
  prompt_template JSONB NOT NULL,
  answer_definition JSONB NOT NULL,
  generator_definition JSONB,
  explanation_content JSONB,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT question_generated_chk CHECK(type <> 'GENERATED' OR generator_definition IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS test_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID NOT NULL REFERENCES tests(id) ON DELETE RESTRICT,
  question_template_id UUID NOT NULL REFERENCES question_templates(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL,
  points NUMERIC(8,2) NOT NULL DEFAULT 1,
  UNIQUE(test_id, position),
  CONSTRAINT test_questions_points_chk CHECK(points > 0)
);

ALTER TABLE course_lesson_blocks ADD COLUMN IF NOT EXISTS test_id UUID REFERENCES tests(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS test_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  test_id UUID NOT NULL REFERENCES tests(id) ON DELETE RESTRICT,
  course_enrollment_id UUID REFERENCES course_enrollments(id) ON DELETE RESTRICT,
  status test_attempt_status NOT NULL DEFAULT 'IN_PROGRESS',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  score NUMERIC(10,2),
  max_score NUMERIC(10,2),
  percentage NUMERIC(5,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS test_attempt_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES test_attempts(id) ON DELETE RESTRICT,
  test_question_id UUID NOT NULL REFERENCES test_questions(id) ON DELETE RESTRICT,
  generated_prompt JSONB NOT NULL,
  generated_answer_definition JSONB NOT NULL,
  position INTEGER NOT NULL,
  student_answer JSONB,
  is_correct BOOLEAN,
  points_awarded NUMERIC(8,2),
  answered_at TIMESTAMPTZ,
  UNIQUE(attempt_id, position)
);

CREATE TABLE IF NOT EXISTS student_mistakes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  question_template_id UUID NOT NULL REFERENCES question_templates(id) ON DELETE RESTRICT,
  topic_id UUID REFERENCES subject_topics(id) ON DELETE RESTRICT,
  status mistake_status NOT NULL DEFAULT 'ACTIVE',
  wrong_count INTEGER NOT NULL DEFAULT 1,
  first_wrong_attempt_question_id UUID REFERENCES test_attempt_questions(id) ON DELETE RESTRICT,
  last_wrong_at TIMESTAMPTZ NOT NULL,
  corrected_at TIMESTAMPTZ,
  UNIQUE(student_id, question_template_id),
  CONSTRAINT student_mistakes_count_chk CHECK(wrong_count > 0)
);
