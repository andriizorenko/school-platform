# 0016 — Availability editor, teacher matching and onboarding

This slice combines three previously separate operational tasks into one manager workflow.

## Teacher availability editor

The seasonal availability editor is now reusable by the teacher and by privileged school staff. It supports:

- separate `SCHOOL_YEAR` and `SUMMER` templates;
- multiple intervals per weekday;
- a visual weekly overview;
- copying one weekday into any selected weekdays;
- copying the current template into the other season;
- exact time editing in 30-minute-friendly inputs;
- one-off all-day or custom-hour exceptions;
- editing and deleting future exceptions.

Availability changes continue to be audit logged. Vacation requests remain a separate approval workflow and are not represented as availability exceptions.

## Schedule-based teacher matching

`POST /api/teachers/match-schedule` accepts a subject, schedule start date and one or more requested recurring slots.

The matcher first checks whether each requested slot is covered by the teacher's seasonal weekly template. It then checks the next 28 days for temporary operational conflicts caused by:

- approved vacations;
- one-off availability exceptions;
- already scheduled lessons.

Results are sorted as:

1. full template match with no near-term conflict (`selectable`);
2. full template match with temporary conflicts;
3. partial match;
4. no match.

A temporary conflict is intentionally not treated as a permanent loss of availability. This lets managers distinguish “the teacher normally works this time but is unavailable on one upcoming date” from “this time is not in the teacher's regular availability at all.”

## New-student onboarding

The manager/admin new-student flow now collects the requested subject and regular weekly schedule before teacher assignment. The same form runs the schedule matcher, shows full and partial matches, and only allows immediate selection of a teacher when the exact schedule can currently be materialized without conflict.

If a full selectable teacher is chosen, onboarding creates in sequence:

1. family and parent account;
2. student profile (and optional student account);
3. primary manager assignment;
4. student-subject enrollment;
5. primary teacher assignment;
6. regular schedule version.

If no teacher is selected, the family/student/enrollment can still be created and matching can be resolved later.

## Security / scope

Teachers can continue to edit only their own availability. `ADMIN`, `MANAGER` and `SUPPORT_MANAGER` may edit a teacher's availability on the teacher profile, which matches the agreed operational model. Teacher matching is restricted to privileged school staff.
