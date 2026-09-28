import assert from "node:assert/strict";
import test from "node:test";
import { isPgExclusionViolation, isPgUniqueViolation, pgConstraint } from "./pg-errors";

test("reads direct PostgreSQL errors", () => {
  const error = { code: "23P01", constraint: "teacher_session_no_overlap" };
  assert.equal(isPgExclusionViolation(error), true);
  assert.equal(pgConstraint(error), "teacher_session_no_overlap");
});

test("unwraps Drizzle-style nested causes", () => {
  const error = {
    name: "DrizzleQueryError",
    cause: {
      code: "23P01",
      constraint: "student_session_no_overlap",
    },
  };
  assert.equal(isPgExclusionViolation(error), true);
  assert.equal(pgConstraint(error), "student_session_no_overlap");
});

test("unwraps nested unique violations", () => {
  const error = {
    cause: {
      cause: {
        code: "23505",
        constraint: "example_uidx",
      },
    },
  };
  assert.equal(isPgUniqueViolation(error), true);
  assert.equal(pgConstraint(error), "example_uidx");
});
