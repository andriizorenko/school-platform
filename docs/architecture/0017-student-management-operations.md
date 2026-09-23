# 0017 — Student management operations

This slice turns the manager/admin student card into the operational control point for an active tutoring enrollment.

## Primary teacher change

A primary-teacher change is not a bare `teacher_assignments` update. The scheduling service validates that the new teacher:

- actively teaches the enrollment subject;
- covers the current regular schedule for the next 28 days;
- has no conflicting scheduled lessons in those regular occurrences;
- is available for every already materialized future lesson that would move from the old primary teacher.

If validation succeeds, one transaction closes the old assignment, creates the new one, updates future `primary_teacher_id`, moves `actual_teacher_id` only where the old primary teacher was actually assigned, writes audit, and emits notifications. Existing explicit substitute assignments are preserved.

## Permanent schedule change

Permanent schedule edits continue to use versioned `regular_schedule_versions`. The UI creates a future-effective version rather than mutating history. The existing funding materializer cancels obsolete future occurrences and rebuilds the paid/booked horizon from the new schedule.

## Enrollment lifecycle and balance

The student card exposes the already-ledgered business actions:

- **Freeze** → enrollment becomes `PAUSED`, future funding is released, lesson credits remain available for a later return.
- **Write off / finish** → remaining credits are consumed by an auditable `WRITE_OFF` debit and enrollment becomes `INACTIVE`.
- **Reactivate** → enrollment returns to `ACTIVE` and funding is materialized again.
- **Transfer** → unreserved, non-compensation credits can move to another child in the same family and same subject.

No operation directly overwrites a numeric balance.
