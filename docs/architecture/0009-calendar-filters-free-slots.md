# 0009 — Calendar filters and safe rescheduling

This slice keeps lesson movement inside the scheduling domain instead of letting the UI invent arbitrary times.

## Global calendar filters

`GET /api/calendar/filter-options` is available to ADMIN, MANAGER and SUPPORT_MANAGER and returns compact lists of active teachers, students, subjects and managers. The calendar query already supports:

- `teacherId`
- `studentId`
- `subjectId`
- `managerId`
- `sessionType=FIRST|REGULAR`
- `fundingStatus=PAID|BOOKED`

Admin/manager web calendars expose these as one filter panel. Fixed page filters (for example the First Lessons page) remain fixed and cannot accidentally be cleared by the UI.

## Free-slot rescheduling

`GET /api/sessions/:sessionId/free-slots?days=14` returns only slots that satisfy all of the following:

- the current actual teacher is available according to the seasonal availability template;
- date exceptions and approved vacations are respected;
- the teacher has no overlapping scheduled/conducted lesson;
- the student has no overlapping lesson;
- the slot is in the future;
- the current lesson itself is excluded from the conflict check.

Slots use a 30-minute search grid, while preserving the original lesson duration (30 or 60 minutes).

Parents are checked against the existing two-hour self-reschedule cutoff before free slots are returned. This means the UI cannot bypass the rule by querying slots first.

## Move to end of subscription

For a regular lesson, staff/teacher can choose `END_OF_PAID_SEQUENCE` without supplying a timestamp. The backend first tries the earliest existing BOOKED regular occurrence after the current paid sequence. The BOOKED placeholder is cancelled atomically before the moved lesson takes its time.

If no suitable BOOKED placeholder exists, the scheduling engine searches the future regular schedule (up to 180 days), while checking teacher availability and teacher/student conflicts.

Parents do not receive this action; their self-service movement remains limited to a free slot of the same teacher.

All moves keep `session_reschedules` history, audit records and notification outbox events.
