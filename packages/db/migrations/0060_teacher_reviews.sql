CREATE TABLE IF NOT EXISTS teacher_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES parent_profiles(user_id) ON DELETE RESTRICT,
  teacher_id UUID NOT NULL REFERENCES teacher_profiles(user_id) ON DELETE RESTRICT,
  session_id UUID NOT NULL REFERENCES live_sessions(id) ON DELETE RESTRICT,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL CHECK (char_length(btrim(comment)) BETWEEN 10 AND 1000),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  moderated_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  moderated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT teacher_reviews_parent_teacher_uidx UNIQUE (parent_id, teacher_id),
  CONSTRAINT teacher_reviews_session_uidx UNIQUE (session_id)
);
CREATE INDEX IF NOT EXISTS teacher_reviews_moderation_idx ON teacher_reviews(status, created_at);
CREATE INDEX IF NOT EXISTS teacher_reviews_teacher_idx ON teacher_reviews(teacher_id, status, created_at DESC);
