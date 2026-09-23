# Architecture 0004 — Scheduling core

This slice introduces the first production-shaped scheduling core.

## Availability

Teacher availability is stored as two long-lived weekly templates:

- `SCHOOL_YEAR`
- `SUMMER`

Each template contains multiple windows per weekday. One-off date exceptions and vacation requests are separate records so recurring availability is not rewritten for temporary changes.

Teachers can manage their own availability. Admin, Manager and Support Manager can manage a teacher's availability operationally. Access is checked again in the service so a Teacher cannot change another teacher's template.

## Regular schedules

A student's recurring schedule is versioned per `StudentSubjectEnrollment`:

- `regular_schedule_versions`
- `regular_schedule_slots`

Changing a permanent schedule closes the previous version and creates a new version. Historical versions remain queryable.

Only one schedule version may cover a given date for an enrollment; PostgreSQL protects this with an exclusion constraint.

## Live sessions

Concrete calendar occurrences live in `live_sessions` and preserve:

- student
- enrollment and subject
- primary teacher
- actual teacher (for future substitutes)
- lesson type (`FIRST` / `REGULAR`)
- funding status (`PAID` / `BOOKED`)
- scheduling status
- exact UTC start/end timestamps

Regular materialized sessions retain their source `schedule_slot_id` and `occurrence_date`, making materialization idempotent and preserving identity after a one-off reschedule.

PostgreSQL exclusion constraints reject overlapping active/historical-effective sessions for both the actual teacher and the student.

## M0 materialization rule (superseded by M1)

The original M0 scheduling milestone temporarily materialized four weeks (`28` days) of concrete sessions as `PAID` so the calendar could be exercised before Billing existed. **This behavior is no longer active.** M1 (`0005-billing-lesson-marking.md`) replaced it with balance-backed `PAID` sessions plus a 14-calendar-day `BOOKED` tail.

This is explicitly temporary. M1 Billing will replace the horizon strategy with:

```text
paid lesson horizon
+
14 calendar days of BOOKED reservation tail
```

The `LiveSession` model already supports that final behavior, so the database shape does not need to change.

## Time zone

School-facing weekly time is interpreted in `Europe/Kyiv`, while concrete session timestamps are stored as `TIMESTAMPTZ`. The conversion helper accounts for daylight-saving offsets when turning local date/time combinations into UTC instants.

## Calendar API

`GET /api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD`

Optional privileged filters:

- `teacherId`
- `studentId`
- `subjectId`

Scope is enforced server-side:

- Admin / Manager / Support Manager — global calendar
- Teacher — only sessions where they are the actual teacher
- Parent — only children in their family
- Student — only their own sessions

The API returns UI-oriented calendar events rather than raw database rows.

## Rescheduling

`POST /api/sessions/:sessionId/reschedule`

The operation keeps the same `LiveSession` and appends a `session_reschedules` history record. Teacher/student overlap is protected by the database. The requested time must also fit the actual teacher's availability.

Parent self-service uses the agreed two-hour cutoff against the session's current start time. Repeated parent reschedules therefore apply the same cutoff each time.

## Temporary permissions

The permission guard now supports scoped temporary grants in addition to role permissions.

The regular schedule endpoint declares an `ENROLLMENT` scope. A teacher without the normal `student.schedule.manage` role permission can therefore receive a temporary grant for a single enrollment without becoming a Manager.

## Policy persistence

The slice also creates persistence for:

- student attendance strike state per enrollment
- teacher strike state per teacher + enrollment
- session incidents
- student pauses
- teacher vacation requests

The strike transition services themselves belong to the lesson-marking/Billing slice.
