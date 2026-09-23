# ADR 0006 — Attendance incidents, first lessons and balance operations

## Status

Accepted for **M1.1 Policy & First Lesson v6**.

## Student no-show policy

Policy state is stored per `StudentSubjectEnrollment`.

- First no-show before reset: incident only, no lesson-credit debit, no teacher payroll. Teacher must wait 15 minutes before recording it unless privileged staff records an override. The same `LiveSession` remains scheduled so it can be rescheduled.
- Five normally completed lessons reset a first strike (implemented in the regular lesson completion flow).
- Second no-show before reset: the session becomes `CHARGED_NO_SHOW`, its credit reservation is consumed, lesson credits are debited, and the actual teacher receives normal pay. No fake topic/homework is created.
- After the second strike the policy state resets to zero.

A second incident cannot be recorded against the same scheduled occurrence until the session has actually been rescheduled.

## Teacher late-cancellation policy

Policy state is per `(enrollment, teacher)`.

- First late cancellation: no student debit and no teacher pay; the same session must be rescheduled.
- Five normally completed lessons by that same teacher with that same enrollment reset the strike.
- Second late cancellation before reset: no debit and no pay for the cancelled occurrence, but a compensation credit grant is created for the lesson duration. The grant is restricted to the culpable teacher and adds to the student's entitlement.

The existing regular-lesson completion allocator prefers a matching teacher-compensation grant. When the culpable teacher later conducts a lesson using those credits, that compensated portion earns zero payroll.

## First lessons

A first lesson is a `LiveSession` with:

- `session_type = FIRST`
- no regular enrollment required
- a full 60-minute reserved calendar slot
- `BOOKED` before financial coverage
- `PAID` only after the first-lesson order is recorded

First-lesson payment must be recorded before lesson start. A zero-price promotion can still be represented as a `PAID` order with `total = 0` later; customer discounts never change teacher pay.

Completing the first lesson atomically requires an `INITIAL` progress report containing strengths, gaps and action plan. The completion also creates a fixed 150 UAH teacher payroll accrual. This amount is intentionally separate from customer first-lesson pricing.

## Balance operations

### Freeze

Freezing changes the enrollment to `PAUSED`, releases future financial reservations and hides future regular occurrences as `EXPIRED_UNPAID`. Credits remain in the ledger unchanged.

### Write-off

Writing off ends the enrollment (`INACTIVE`) and consumes every remaining credit with a `WRITE_OFF` debit and allocations. It refuses to proceed while unresolved paid sessions still hold active reservations.

### Family transfer

A manager can transfer lesson credits between two children only when:

- both enrollments belong to the same family;
- both are for the same subject;
- the source has enough unreserved credits;
- the transferred credits are not teacher-compensation credits.

The operation creates one transfer record, one `TRANSFER_OUT` debit with grant allocations, and one `TRANSFER_IN` grant. Both funding plans are recalculated in the same transaction.

## Funding materialization correction

Past scheduled lessons with unresolved active reservations must retain those reservations. Funding refresh therefore releases only future reservations and subtracts unresolved past reservations from credits available for future materialization.
