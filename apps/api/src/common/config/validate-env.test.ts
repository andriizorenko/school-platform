import assert from "node:assert/strict";
import test from "node:test";
import { validateEnvironment } from "./validate-env";

test("accepts development defaults when DATABASE_URL is present", () => {
  const env = validateEnvironment({ DATABASE_URL: "postgresql://example", NODE_ENV: "development" });
  assert.equal(env.API_PORT, 3001);
  assert.equal(env.SESSION_TTL_DAYS, 30);
  assert.equal(env.WEB_URL, "http://localhost:3000");
  assert.equal(env.WORKER_HEARTBEAT_MAX_AGE_SECONDS, 120);
});


test("validates worker heartbeat staleness threshold", () => {
  const env = validateEnvironment({ DATABASE_URL: "postgresql://example", WORKER_HEARTBEAT_MAX_AGE_SECONDS: "45" });
  assert.equal(env.WORKER_HEARTBEAT_MAX_AGE_SECONDS, 45);
  assert.throws(
    () => validateEnvironment({ DATABASE_URL: "postgresql://example", WORKER_HEARTBEAT_MAX_AGE_SECONDS: "0" }),
    /WORKER_HEARTBEAT_MAX_AGE_SECONDS/,
  );
});

test("requires strong application and MFA secrets in production", () => {
  assert.throws(
    () => validateEnvironment({ DATABASE_URL: "postgresql://example", NODE_ENV: "production", APP_ENCRYPTION_KEY: "short", MFA_ENCRYPTION_KEY: "short" }),
    /APP_ENCRYPTION_KEY/,
  );
});

test("requires Telegram metadata when a bot token is configured", () => {
  assert.throws(
    () => validateEnvironment({ DATABASE_URL: "postgresql://example", TELEGRAM_BOT_TOKEN: "token" }),
    /TELEGRAM_BOT_USERNAME/,
  );
});


test("LiqPay configuration is validated as a complete set", () => {
  assert.throws(() => validateEnvironment({ DATABASE_URL: "postgresql://example", PAYMENT_PROVIDER: "LIQPAY" }), /LIQPAY_PUBLIC_KEY/);
  const env = validateEnvironment({
    DATABASE_URL: "postgresql://example",
    PAYMENT_PROVIDER: "liqpay",
    LIQPAY_PUBLIC_KEY: "public",
    LIQPAY_PRIVATE_KEY: "private",
    LIQPAY_CALLBACK_URL: "https://api.example.test/api/integrations/payments/liqpay/callback",
  });
  assert.equal(env.PAYMENT_PROVIDER, "LIQPAY");
});

test("Monobank acquiring configuration is validated as a complete set", () => {
  assert.throws(
    () => validateEnvironment({ DATABASE_URL: "postgresql://example", PAYMENT_PROVIDER: "MONO" }),
    /MONO_TOKEN/,
  );
  const env = validateEnvironment({
    DATABASE_URL: "postgresql://example",
    PAYMENT_PROVIDER: "mono",
    MONO_TOKEN: "test-token",
    MONO_WEBHOOK_URL: "https://api.example.test/api/integrations/payments/mono/webhook",
    MONO_RESULT_URL: "https://school.example.test/parent/payments",
  });
  assert.equal(env.PAYMENT_PROVIDER, "MONO");
  assert.equal(env.PAYMENT_DEFAULT_PROVIDER, "MONO");
  assert.equal(env.MONO_ENABLED, true);
});

test("supports LiqPay and Monobank together with an explicit default", () => {
  const env = validateEnvironment({
    DATABASE_URL: "postgresql://example",
    PAYMENT_PROVIDER: "NONE",
    PAYMENT_DEFAULT_PROVIDER: "MONO",
    LIQPAY_ENABLED: "true",
    MONO_ENABLED: "true",
    LIQPAY_PUBLIC_KEY: "public",
    LIQPAY_PRIVATE_KEY: "private",
    LIQPAY_CALLBACK_URL: "https://api.example.test/api/integrations/payments/liqpay/callback",
    MONO_TOKEN: "test-token",
    MONO_WEBHOOK_URL: "https://api.example.test/api/integrations/payments/mono/webhook",
  });
  assert.equal(env.PAYMENT_DEFAULT_PROVIDER, "MONO");
  assert.equal(env.LIQPAY_ENABLED, true);
  assert.equal(env.MONO_ENABLED, true);
});

test("rejects a default provider that is disabled", () => {
  assert.throws(
    () => validateEnvironment({
      DATABASE_URL: "postgresql://example",
      PAYMENT_PROVIDER: "NONE",
      PAYMENT_DEFAULT_PROVIDER: "MONO",
      MONO_ENABLED: "false",
    }),
    /MONO_ENABLED=true/,
  );
});


test("rejects an invalid configured Monobank webhook public key", () => {
  assert.throws(
    () => validateEnvironment({
      DATABASE_URL: "postgresql://example",
      PAYMENT_PROVIDER: "MONO",
      MONO_TOKEN: "test-token",
      MONO_WEBHOOK_URL: "https://api.example.test/api/integrations/payments/mono/webhook",
      MONO_WEBHOOK_PUBLIC_KEY_BASE64: Buffer.from("not a public key").toString("base64"),
    }),
    /MONO_WEBHOOK_PUBLIC_KEY_BASE64/,
  );
});

test("production hardening requires HTTPS plus dedicated hashing secrets", () => {
  const base = {
    DATABASE_URL: "postgresql://example",
    NODE_ENV: "production",
    APP_ENCRYPTION_KEY: "a".repeat(32),
    MFA_ENCRYPTION_KEY: "b".repeat(32),
    RATE_LIMIT_HASH_KEY: "c".repeat(32),
    LOG_HASH_KEY: "d".repeat(32),
    WEB_URL: "https://school.example.test",
    API_URL: "https://api.school.example.test",
  };
  const env = validateEnvironment(base);
  assert.equal(env.RATE_LIMIT_ENABLED, true);
  assert.equal(env.STRICT_ORIGIN_CHECK_ENABLED, true);
  assert.throws(() => validateEnvironment({ ...base, WEB_URL: "http://school.example.test" }), /WEB_URL must use HTTPS/);
  assert.throws(() => validateEnvironment({ ...base, RATE_LIMIT_HASH_KEY: "short" }), /RATE_LIMIT_HASH_KEY/);
});

test("production metrics require a strong bearer token", () => {
  const base = {
    DATABASE_URL: "postgresql://example",
    NODE_ENV: "production",
    APP_ENCRYPTION_KEY: "a".repeat(32),
    MFA_ENCRYPTION_KEY: "b".repeat(32),
    RATE_LIMIT_HASH_KEY: "c".repeat(32),
    LOG_HASH_KEY: "d".repeat(32),
    WEB_URL: "https://school.example.test",
    API_URL: "https://api.school.example.test",
    METRICS_ENABLED: "true",
  };
  assert.throws(() => validateEnvironment(base), /METRICS_TOKEN/);
  const env = validateEnvironment({ ...base, METRICS_TOKEN: "m".repeat(32) });
  assert.equal(env.METRICS_ENABLED, true);
});

test("production payment callbacks must use HTTPS", () => {
  const base = {
    DATABASE_URL: "postgresql://example",
    NODE_ENV: "production",
    APP_ENCRYPTION_KEY: "a".repeat(32),
    MFA_ENCRYPTION_KEY: "b".repeat(32),
    RATE_LIMIT_HASH_KEY: "c".repeat(32),
    LOG_HASH_KEY: "d".repeat(32),
    WEB_URL: "https://school.example.test",
    API_URL: "https://api.school.example.test",
    PAYMENT_PROVIDER: "MONO",
    MONO_TOKEN: "token",
    MONO_WEBHOOK_URL: "http://api.school.example.test/api/integrations/payments/mono/webhook",
  };
  assert.throws(() => validateEnvironment(base), /MONO_WEBHOOK_URL must use HTTPS/);
});
