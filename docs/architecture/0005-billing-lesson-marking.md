# 0005 — Billing and lesson marking (M1)

## Scope

This slice replaces the temporary M0 `PAID` session materialization with balance-backed funding and adds the first end-to-end lesson completion flow.

## Money and lesson units

Customer money is stored in minor currency units (kopiykas for UAH). Lesson entitlement is stored separately as integer credits:

- 60 minutes = 2 credits = 1 lesson unit
- 30 minutes = 1 credit = 0.5 lesson unit

Customer money, lesson credits and teacher payroll are intentionally separate ledgers.

## Subject pricing

`subject_price_versions` stores versioned subject pricing. A new version can be scheduled for a future date; the previous open-ended version is closed the day before it starts. PostgreSQL prevents overlapping price periods.

The 30-minute customer price is derived as 50% of the 60-minute price and is not stored as an independent tariff.

## Manual top-up

Managers/Admin/Support can record a manual lesson purchase:

1. lock the enrollment;
2. resolve the active subject price;
3. create a paid `orders` record;
4. create a successful manual `payments` record;
5. create `lesson_topups` with immutable pricing snapshots;
6. grant `2 × lessonUnits` credits;
7. recompute future `PAID` sessions and the 14-day `BOOKED` tail;
8. write audit data in the same transaction.

The manager flow can grant fewer than 10 lesson units. The future online checkout will enforce the 10-unit minimum separately.

## Balance ledger

The displayed lesson balance is derived from immutable grants minus debits. It is never updated with `UPDATE balance = ...`.

`lesson_credit_grants` records purchases and future compensation/transfer/manual grants.

`lesson_credit_debits` records lesson completion, paid no-shows, transfers, write-offs and manual corrections.

`lesson_credit_allocations` preserves which grants funded each debit.

## Future-session funding

`session_credit_reservations` reserves credits for future `PAID` sessions without reducing the displayed balance.

The funding materializer follows this invariant:

```text
current undebited balance
  -> sequential future PAID sessions
  -> ACTIVE credit reservation per PAID session
  -> 14 calendar days of BOOKED sessions after the last PAID occurrence
  -> anything beyond the tail is EXPIRED_UNPAID and no longer blocks the slot
```

When the balance is zero, only the 14-day booking tail is retained. A `BOOKED` regular lesson cannot be marked as conducted.

## Regular lesson marking

`POST /api/sessions/:sessionId/mark` currently handles regular 30/60 minute tutoring sessions.

Teacher rules:

- the lesson must already have ended;
- the caller must be the actual teacher;
- the session must be `PAID`;
- the session must have an ACTIVE credit reservation;
- teacher marking is allowed only through 48 hours after lesson end;
- topic is required;
- homework is stored only as assigned/not assigned.

Manager/Admin/Support can mark a historical lesson after the teacher window expires.

The transaction atomically:

```text
LiveSession -> COMPLETED
credit reservation -> CONSUMED
credit debit + allocations
teacher payroll accrual
student clean-streak update
teacher/student clean-streak update
audit log
```

## Payroll accrual

Teacher accrual uses the effective teacher+subject rate on the local Kyiv lesson date and snapshots that rate into `payroll_accruals`.

- 60 minutes = 100% rate
- 30 minutes = 50% rate
- compensation credits tied to the culpable teacher can reduce the payable amount for the credits they cover

Accruals are immutable source records for later 14-day payroll periods; payout-period settlement is intentionally deferred to the payroll slice.

## Journal

`GET /api/enrollments/:enrollmentId/journal` is derived from completed `LiveSession` records. It exposes topic, homework flag, actual teacher and whether the teacher was a substitute. `CHARGED_NO_SHOW` is intentionally not represented as a conducted journal lesson.

## Still pending

- first-lesson completion + mandatory initial report
- no-show actions and second-strike charging flow
- teacher late-cancellation compensation issuance
- balance transfer between children
- write-off/freeze manager UI actions
- promotions and online payment provider webhooks
- low-balance/zero-balance notifications
- payroll periods and financier payouts
