# 0012 — Notification preferences UI and role-aware audiences

This increment turns the existing notification backend into a user-facing settings experience.

## Decisions

- Notification event types have explicit role audiences through `notification_event_roles`.
- Parents, students and teachers only see switches relevant to their role.
- Manager/admin/support/financier remain intentionally minimal; security events are mandatory and therefore not user-configurable.
- The current UI exposes Telegram preferences. Email stays reserved for account/security flows until an email delivery worker is implemented.
- Telegram linking is initiated with a short-lived deep link and the profile page polls for confirmation after the bot is opened.
- The profile page shows recent platform notifications and allows individual or bulk read acknowledgement.
- Notification history is durable PostgreSQL data. Telegram delivery history remains separately available in `notification_deliveries`.

## Audience examples

- `LOW_BALANCE`, `ZERO_BALANCE` → parent only.
- `REPORT_REQUESTED`, `UNMARKED_LESSON_REMINDER` → teacher only.
- `LESSON_REMINDER` → parent + student.
- `LESSON_RESCHEDULED`, `REGULAR_SCHEDULE_CHANGED`, `SUBSTITUTE_ASSIGNED` → parent + student + teacher.
- `SECURITY_ACCOUNT_CHANGED` → all roles, mandatory.
