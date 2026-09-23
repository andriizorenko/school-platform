import assert from "node:assert/strict";
import test from "node:test";
import { redactPath, redactText, redactValue } from "./redaction";

test("redacts credential-like text and email addresses", () => {
  const output = redactText("Bearer abc.def user@example.com password=hunter2 token=secret-token");
  assert.equal(output.includes("abc.def"), false);
  assert.equal(output.includes("user@example.com"), false);
  assert.equal(output.includes("hunter2"), false);
  assert.equal(output.includes("secret-token"), false);
});

test("redacts sensitive object keys recursively", () => {
  const output = redactValue({ authorization: "Bearer secret", nested: { privateKey: "pem", ok: "value" } }) as any;
  assert.equal(output.authorization, "[REDACTED]");
  assert.equal(output.nested.privateKey, "[REDACTED]");
  assert.equal(output.nested.ok, "value");
});

test("normalizes UUID and long numeric path identifiers", () => {
  assert.equal(
    redactPath("/api/students/123e4567-e89b-12d3-a456-426614174000/history/1234567890"),
    "/api/students/:id/history/:id",
  );
});
