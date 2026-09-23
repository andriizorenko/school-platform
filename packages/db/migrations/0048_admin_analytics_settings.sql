ALTER TABLE school_settings
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN IF NOT EXISTS value_type TEXT NOT NULL DEFAULT 'JSON',
  ADD COLUMN IF NOT EXISTS unit TEXT,
  ADD COLUMN IF NOT EXISTS min_numeric NUMERIC,
  ADD COLUMN IF NOT EXISTS max_numeric NUMERIC,
  ADD COLUMN IF NOT EXISTS is_critical BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 100;

DO $$ BEGIN
  ALTER TABLE school_settings
    ADD CONSTRAINT school_settings_value_type_chk
    CHECK (value_type IN ('INTEGER','NUMBER','STRING','MONTH_DAY','DATE','TIMEZONE','JSON'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO school_settings(key,value,description,category,value_type,unit,min_numeric,max_numeric,is_critical,sort_order)
VALUES
  ('student_no_show_wait_minutes','15','Minutes a teacher must wait before recording a student no-show','LESSONS','INTEGER','хв',0,120,false,35)
ON CONFLICT(key) DO NOTHING;

UPDATE school_settings SET category='SCHEDULING',value_type='INTEGER',unit='хв',min_numeric=0,max_numeric=1440,is_critical=true,sort_order=10 WHERE key='parent_reschedule_cutoff_minutes';
UPDATE school_settings SET category='LESSONS',value_type='INTEGER',unit='год',min_numeric=1,max_numeric=168,is_critical=true,sort_order=20 WHERE key='teacher_mark_deadline_hours';
UPDATE school_settings SET category='SCHEDULING',value_type='INTEGER',unit='днів',min_numeric=1,max_numeric=60,is_critical=true,sort_order=30 WHERE key='reservation_tail_days';
UPDATE school_settings SET category='BILLING',value_type='INTEGER',unit='занять',min_numeric=1,max_numeric=100,is_critical=true,sort_order=40 WHERE key='online_min_lesson_units';
UPDATE school_settings SET category='BILLING',value_type='INTEGER',unit='занять',min_numeric=0,max_numeric=100,is_critical=false,sort_order=50 WHERE key='low_balance_lesson_units';
UPDATE school_settings SET category='LESSONS',value_type='INTEGER',unit='занять',min_numeric=1,max_numeric=30,is_critical=true,sort_order=60 WHERE key='policy_clean_streak_reset';
UPDATE school_settings SET category='REPORTS',value_type='INTEGER',unit='занять',min_numeric=1,max_numeric=50,is_critical=false,sort_order=70 WHERE key='report_request_min_lessons';
UPDATE school_settings SET category='AVAILABILITY',value_type='MONTH_DAY',unit=NULL,is_critical=true,sort_order=80 WHERE key='school_year_start';
UPDATE school_settings SET category='AVAILABILITY',value_type='MONTH_DAY',unit=NULL,is_critical=true,sort_order=90 WHERE key='school_year_end';
UPDATE school_settings SET category='PAYROLL',value_type='INTEGER',unit='коп.',min_numeric=0,max_numeric=100000000,is_critical=true,sort_order=100 WHERE key='first_lesson_teacher_pay_minor';
UPDATE school_settings SET category='NOTIFICATIONS',value_type='INTEGER',unit='хв',min_numeric=0,max_numeric=1440,is_critical=false,sort_order=110 WHERE key='lesson_reminder_minutes';
UPDATE school_settings SET category='NOTIFICATIONS',value_type='INTEGER',unit='год',min_numeric=1,max_numeric=336,is_critical=false,sort_order=120 WHERE key='notification_planning_horizon_hours';
UPDATE school_settings SET category='NOTIFICATIONS',value_type='INTEGER',unit='година',min_numeric=0,max_numeric=23,is_critical=false,sort_order=130 WHERE key='unmarked_reminder_local_hour';
UPDATE school_settings SET category='NOTIFICATIONS',value_type='INTEGER',unit='спроб',min_numeric=1,max_numeric=20,is_critical=false,sort_order=140 WHERE key='notification_retry_max_attempts';
UPDATE school_settings SET category='NOTIFICATIONS',value_type='INTEGER',unit='сек',min_numeric=1,max_numeric=3600,is_critical=false,sort_order=150 WHERE key='notification_retry_base_seconds';
UPDATE school_settings SET category='GENERAL',value_type='TIMEZONE',unit=NULL,is_critical=true,sort_order=5 WHERE key='school_timezone';
UPDATE school_settings SET category='PAYROLL',value_type='DATE',unit=NULL,is_critical=true,sort_order=160 WHERE key='payroll_anchor_date';
UPDATE school_settings SET category='PAYROLL',value_type='INTEGER',unit='днів',min_numeric=1,max_numeric=62,is_critical=true,sort_order=170 WHERE key='payroll_period_days';
UPDATE school_settings SET category='PAYROLL',value_type='INTEGER',unit='днів',min_numeric=1,max_numeric=31,is_critical=true,sort_order=180 WHERE key='payroll_payout_window_days';
UPDATE school_settings SET category='COURSES',value_type='INTEGER',unit='%',min_numeric=0,max_numeric=100,is_critical=false,sort_order=190 WHERE key='course_low_score_threshold_percent';
UPDATE school_settings SET category='COURSES',value_type='INTEGER',unit='MB',min_numeric=1,max_numeric=30,is_critical=false,sort_order=200 WHERE key='course_pdf_max_size_mb';
UPDATE school_settings SET category='LESSONS',value_type='INTEGER',unit='хв',min_numeric=0,max_numeric=120,is_critical=false,sort_order=25 WHERE key='student_no_show_wait_minutes';

CREATE INDEX IF NOT EXISTS orders_paid_period_idx ON orders(paid_at DESC) WHERE status='PAID';
CREATE INDEX IF NOT EXISTS payroll_accruals_earned_period_idx ON payroll_accruals(earned_for_date DESC, subject_id);
CREATE INDEX IF NOT EXISTS live_sessions_completed_period_idx ON live_sessions(ends_at DESC, session_type, actual_teacher_id) WHERE status='COMPLETED';
CREATE INDEX IF NOT EXISTS live_sessions_attention_idx ON live_sessions(starts_at, funding_status) WHERE status='SCHEDULED';

INSERT INTO permissions(code,description)
VALUES ('finance.analytics.view','View school-wide revenue and operating financial analytics')
ON CONFLICT(code) DO UPDATE SET description=EXCLUDED.description;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='ADMIN' AND p.code='finance.analytics.view'
ON CONFLICT DO NOTHING;

DELETE FROM role_permissions rp
USING roles r, permissions p
WHERE rp.role_id=r.id AND rp.permission_id=p.id
  AND r.code='FINANCIER' AND p.code='ops.dashboard.view';
