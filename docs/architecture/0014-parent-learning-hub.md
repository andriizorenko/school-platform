# ADR 0014 — Parent family learning hub

## Goal

The parent learning area is a family-level workspace rather than a collection of disconnected report cards. It combines each child's tutoring subjects, journal history and progress reports while preserving student/subject boundaries in the domain model.

## Report request eligibility

`GET /students/:studentId/reports/eligibility` returns one row per enrollment. The API, not the UI, decides whether a report can be requested.

States:

- `AVAILABLE` — the enrollment is active, has a primary teacher and reached the configured lesson threshold;
- `PENDING` — a request already exists;
- `TOO_EARLY` — the configured threshold has not been reached;
- `INACTIVE` — tutoring for the subject is not active;
- `NO_TEACHER` — there is no current primary teacher.

The threshold is read from `school_settings.report_request_min_lessons`; the request command uses the same setting. This prevents the eligibility UI and the write-side rule from drifting apart.

## Parent UI

For every child and subject the page shows:

- current teacher and remaining lesson units;
- the latest journal entries, with substitute-teacher attribution;
- exact report-request status and lesson progress toward the next request;
- the pending target lesson when a report is already requested;
- first and requested progress reports;
- parent-controlled `visibleToStudent` for each completed report.

The parent can decide whether a newly requested report will become visible in the student cabinet. The setting can also be changed after the report is created.
