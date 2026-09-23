# 0007 — Parent/Student portals, reports and Telegram notifications

## Scope

This slice exposes the first role-specific cabinet read models and adds the event-driven notification foundation.

### Parent cabinet backend

`GET /api/parent/dashboard` returns the single parent profile, all children in the family, the child's primary manager, tutoring enrollments, teacher contact data, remaining lesson units and the nearest lessons. The family schedule itself continues to use the shared `GET /api/calendar` endpoint, which already scopes parent access to all children in the family.

### Student cabinet backend

`GET /api/student/dashboard` returns only the student's own profile, subjects, lesson balances, teacher contacts and nearest lessons. Manager contact is intentionally not returned to students.

Existing `Student` and `Enrollment` read endpoints now enforce family/student/teacher scope server-side. Possessing the broad `student.view` permission is no longer sufficient to read arbitrary student records.

## Progress reports

Parents can request a regular progress report after a default minimum of five completed regular lessons since tutoring started or since the previous requested report. This default is intentionally isolated in the report service and will move to school settings later.

A request is attached to the nearest upcoming regular `LiveSession`. That calendar event exposes `needsReport=true`, allowing the teacher UI to show the prominent `ТРЕБА ЗВІТ` marker.

The target lesson must be completed before the requested report can be submitted. The report records strengths, gaps, an action plan and independent parent/student visibility. A parent can later hide or reveal a specific report for the child account.

Initial first-lesson reports continue to be mandatory and now publish the same `REPORT_READY` notification event.

## Notifications

Business services do not call Telegram directly. They commit a `NOTIFY_*` outbox event in the same PostgreSQL transaction as the business change. The worker materializes those events into durable `notifications` records and delivers Telegram messages independently.

Current notification producers include:

- a first lesson assigned to a teacher;
- a new regular student after the first regular schedule is created;
- a regular schedule change;
- a lesson reschedule;
- a progress report request;
- an initial or requested progress report becoming available.

User preferences are stored per event type and channel. Security events can be declared non-configurable.

## Telegram account linking

Authenticated users request a short-lived one-time linking token. If `TELEGRAM_BOT_USERNAME` is configured, the API returns a Telegram deep link. The bot webhook consumes `/start <token>`, verifies the optional Telegram webhook secret and links the Telegram user/chat IDs to the platform account.

Telegram usernames are display-only; identity is based on Telegram's numeric IDs.

The initial worker uses durable PostgreSQL outbox polling so notification delivery already survives API failures. Redis/BullMQ remains the planned execution layer for delayed reminders and higher-volume jobs; PostgreSQL remains the source of truth.
