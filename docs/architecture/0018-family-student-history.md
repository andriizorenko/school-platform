# 0018 — Family and student operations history

## Goal

Give Admin/Manager/Support a single traceable operational view without exposing internal history to teacher, parent or student accounts.

## Student history

`GET /api/students/:studentId/operations-history` returns:

- primary-manager assignment history;
- every subject enrollment;
- primary-teacher assignment history per enrollment;
- versioned regular schedules and their slots;
- manual/online lesson top-ups with price/payment snapshots;
- lesson-credit ledger grants and debits;
- cross-child lesson transfers;
- related append-only audit events.

The UI deliberately keeps the normal student summary at the top and places traceability below it in expandable sections. This prevents the operational card from becoming unreadable while still making old decisions explainable.

## Family operations view

`GET /api/families/:familyId/operations-overview` consolidates:

- the single parent account and account state;
- all children and their primary managers;
- all child+subject enrollments with current teacher and lesson balance;
- all family orders (regular top-ups, first lessons, courses);
- course licenses and which children currently have access;
- recent significant audit activity.

Family status is derived rather than manually stored: a family is considered active while it has an active tutoring enrollment or a non-expired active course license.

## Security boundary

Both endpoints perform an explicit operational-role check and are limited to:

- `ADMIN`
- `MANAGER`
- `SUPPORT_MANAGER`

Parent/student/teacher-facing APIs remain separate and do not return audit data, price snapshots or internal assignment history.

## Traceability principles

Historical rows are not recomputed using current prices/rates. Purchases keep their original order/top-up snapshots, while the lesson balance is explained by immutable grants/debits. Schedule and teacher changes preserve old versions/assignments rather than overwriting them.

## Query performance

Migration `0042_operations_history_indexes.sql` adds history-oriented indexes for family orders, teacher assignments, schedule versions, manager assignments and student lesson history.
