import { describe, expect, it } from "vitest";
import { isPgExclusionViolation, isPgUniqueViolation, pgConstraint } from "./pg-errors";

describe("PostgreSQL error helpers", () => {
  it("reads direct PostgreSQL errors", () => {
    const error = { code: "23P01", constraint: "teacher_session_no_overlap" };
    expect(isPgExclusionViolation(error)).toBe(true);
    expect(pgConstraint(error)).toBe("teacher_session_no_overlap");
  });

  it("unwraps Drizzle-style nested causes", () => {
    const error = {
      name: "DrizzleQueryError",
      cause: {
        code: "23P01",
        constraint: "student_session_no_overlap",
      },
    };
    expect(isPgExclusionViolation(error)).toBe(true);
    expect(pgConstraint(error)).toBe("student_session_no_overlap");
  });

  it("unwraps nested unique violations", () => {
    const error = {
      cause: {
        cause: {
          code: "23505",
          constraint: "example_uidx",
        },
      },
    };
    expect(isPgUniqueViolation(error)).toBe(true);
    expect(pgConstraint(error)).toBe("example_uidx");
  });
});
