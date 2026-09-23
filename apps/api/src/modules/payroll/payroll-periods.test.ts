import assert from "node:assert/strict";
import test from "node:test";
import { payrollCycleIndex, payrollWindow } from "./payroll-periods";

test("builds the agreed 14-day calculation and 3-day payout windows", () => {
  assert.deepEqual(payrollWindow("2026-09-07", 0, 14, 3), {
    periodStart: "2026-09-07",
    periodEnd: "2026-09-20",
    payoutWindowStart: "2026-09-21",
    payoutWindowEnd: "2026-09-23",
  });
  assert.deepEqual(payrollWindow("2026-09-07", 1, 14, 3), {
    periodStart: "2026-09-21",
    periodEnd: "2026-10-04",
    payoutWindowStart: "2026-10-05",
    payoutWindowEnd: "2026-10-07",
  });
});

test("moves into the next accrual period while the previous payout window is open", () => {
  assert.equal(payrollCycleIndex("2026-09-07", "2026-09-21", 14), 1);
});

test("supports configured period and payout lengths without changing the anchor semantics", () => {
  assert.deepEqual(payrollWindow("2026-09-07", 1, 7, 2), {
    periodStart: "2026-09-14",
    periodEnd: "2026-09-20",
    payoutWindowStart: "2026-09-21",
    payoutWindowEnd: "2026-09-22",
  });
});
