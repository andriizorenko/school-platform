# 0021 — Payroll and Financier hardening

## Goal

Make the 14-day teacher payroll cycle safe to operate with real money: the 3-day payout window may overlap the next accrual period, individual teachers may be paid at different moments, payout requisites can be missing, and a lesson may be marked after its historical payout has already been closed.

## Schedule

Payroll schedule is configured through `school_settings`:

- `payroll_anchor_date` — default `2026-09-07`;
- `payroll_period_days` — default `14`;
- `payroll_payout_window_days` — default `3`.

The first default windows are therefore:

- accrual `2026-09-07 .. 2026-09-20`, payout `2026-09-21 .. 2026-09-23`;
- accrual `2026-09-21 .. 2026-10-04`, payout `2026-10-05 .. 2026-10-07`.

The new accrual period starts immediately while the previous payout window is still open.

## Settlement and late accrual rules

`payroll_accruals` remain the immutable earning events. Calculation assigns still-unsettled accruals whose `earned_for_date` is not later than the selected period end.

A teacher whose payout in that target period is already `PAID` is excluded from new settlement. This is the critical late-marking rule: a lesson marked after that teacher was already paid stays unsettled and is picked up by the next non-closed payroll period. The UI labels an item as a prior-period adjustment when its `earned_for_date` is earlier than the payout period start.

Before a payout is actually paid, recalculation may update that teacher's amount. Once paid, the snapshot may not change.

## Database freeze

Migration `0045_payroll_hardening.sql` adds database triggers that reject mutation or deletion of a `PAID` `teacher_payout` and reject insertion/update/deletion of its payout items. This protects historical amounts even if a future application bug tries to rewrite them.

## Payout requisites

A calculated payout is:

- `PENDING` when the teacher has no active payout requisites;
- `READY` when a payout-destination snapshot exists;
- `PAID` after Financier/Admin confirmation.

Changing payout requisites updates only unpaid payout snapshots. Historical paid payouts retain the destination that was used at the time.

## Financier workspace

The payout list supports:

- 14-day period selection and payout-window context;
- search and status filtering;
- missing-requisites alerts;
- prior-period adjustment amount;
- changes detected after a previous calculation;
- atomic bulk confirmation of up to 100 ready payouts;
- per-teacher breakdown for regular 60m, regular 30m, first lessons, paid student no-shows, compensation lessons and adjustments;
- full payout destination only for Admin/Financier.

The separate Financier teacher list exposes current teacher/subject rates read-only, masked requisites, unsettled accrual and latest payout status. Financier never gets permission to change teacher rates.

## Teacher view

The teacher payout page separates:

- earnings in the current 14-day accrual period;
- historical unsettled corrections that will enter the next payout;
- total not yet closed;
- immutable payout history and payout windows;
- arbitrary date-range statement.

## Permissions

`payroll.view` remains usable for a teacher's own payroll endpoints. School-wide period/payout CRM is protected by the new `payroll.operations.view`, assigned to Financier and Admin. `payroll.confirm` remains separate.
