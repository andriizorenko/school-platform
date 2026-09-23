import assert from "node:assert/strict";
import test from "node:test";
import { loadWorkerSettings } from "./settings.js";

test("worker reads payroll schedule from school settings", async () => {
  const pool = {
    async query() {
      return {
        rows: [
          { key: "payroll_anchor_date", value: "2026-10-01" },
          { key: "payroll_period_days", value: 10 },
          { key: "payroll_payout_window_days", value: 4 },
        ],
      };
    },
  };
  const settings = await loadWorkerSettings(pool as never);
  assert.equal(settings.payrollAnchorDate, "2026-10-01");
  assert.equal(settings.payrollPeriodDays, 10);
  assert.equal(settings.payrollPayoutWindowDays, 4);
});
