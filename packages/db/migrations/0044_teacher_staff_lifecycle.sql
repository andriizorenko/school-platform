-- Teacher/staff lifecycle and admin list lookups.
-- Business history remains append-only; these indexes only support operational reads.
CREATE INDEX IF NOT EXISTS teacher_profiles_archived_idx
  ON teacher_profiles(archived_at, last_name, first_name);

CREATE INDEX IF NOT EXISTS staff_profiles_archived_idx
  ON staff_profiles(archived_at, last_name, first_name);

CREATE INDEX IF NOT EXISTS user_invitations_user_created_idx
  ON user_invitations(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS user_roles_user_idx
  ON user_roles(user_id, role_id);

CREATE INDEX IF NOT EXISTS teacher_assignments_teacher_active_idx
  ON teacher_assignments(teacher_id, enrollment_id)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS teacher_payout_details_teacher_created_idx
  ON teacher_payout_details(teacher_id, created_at DESC);
