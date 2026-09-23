import assert from "node:assert/strict";
import test from "node:test";
import { balanceNotificationDedupKey, lessonReminderDedupKey, retryDelaySeconds } from "./notification-utils.js";

test("retry delay uses capped exponential backoff", () => {
  assert.equal(retryDelaySeconds(60, 1), 60);
  assert.equal(retryDelaySeconds(60, 2), 120);
  assert.equal(retryDelaySeconds(60, 3), 240);
  assert.equal(retryDelaySeconds(60, 20), 3600);
});

test("lesson reminder key changes after a reschedule", () => {
  const first = lessonReminderDedupKey("session-1", new Date("2026-09-22T14:00:00Z"));
  const moved = lessonReminderDedupKey("session-1", new Date("2026-09-22T16:00:00Z"));
  assert.notEqual(first, moved);
});

test("balance notification is scoped to a balance cycle", () => {
  assert.notEqual(
    balanceNotificationDedupKey("zero", "enrollment-1", "grant-1"),
    balanceNotificationDedupKey("zero", "enrollment-1", "grant-2"),
  );
});
