# 0015 — Student learning experience

The student learning UI intentionally stays smaller than the parent cabinet and exposes no prices, payment history or manager contact data.

## Navigation

The primary learning paths remain:

- `Розклад` — all tutoring subjects in one student calendar;
- `Журнал` — per-subject tutoring context, shared journal and visible progress reports;
- `Курси` — self-paced course access and progress.

The journal page repeats these three destinations at the top so mobile users can move between tutoring schedule, learning history and course content without returning to the dashboard.

## Per-subject context

Each subject card contains:

- enrollment status;
- remaining lesson units only (no monetary value);
- primary teacher and direct teacher contact;
- nearest scheduled lesson and the actual teacher for that occurrence;
- Zoom button resolved from the actual teacher, preserving substitute behavior;
- the shared journal including `Провів: ...` only for substitute-conducted lessons;
- completed progress reports that the student is allowed to see.

Telegram usernames are resolved from the active `telegram_connections` record and are display/contact metadata only. Telegram user identity continues to be based on Telegram IDs rather than mutable usernames.

## Report privacy

The student uses the existing `GET /students/:studentId/reports` endpoint. `ReportsService.listForStudent()` applies `visible_to_student = true` for a student actor, so hiding a report in the parent cabinet is enforced server-side rather than only in the UI.

The student page explicitly explains that only parent-approved reports are shown. Hidden reports are not fetched and are not represented as placeholders.

## Journal privacy

The existing enrollment journal scope verifies that the student user belongs to the enrollment before returning the shared history. Substitute attribution is retained, while the student cannot edit journal entries.

## Student dashboard

The dashboard now emphasizes the nearest lesson, quick Zoom access, subject balances and direct navigation to schedule/journal/courses. It intentionally does not show school revenue, lesson prices, payments or the primary manager contact.
