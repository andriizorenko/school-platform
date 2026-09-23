function positiveInteger(value: unknown, key: string, fallback?: number) {
  if (value === undefined || value === null || value === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`${key} is required`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${key} must be a positive integer`);
  return parsed;
}

function nonNegativeInteger(value: unknown, key: string, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${key} must be a non-negative integer`);
  return parsed;
}

function booleanEnv(value: unknown, key: string, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`${key} must be a boolean`);
}

function requireSecret(env: Record<string, unknown>, key: string, minLength = 32) {
  const value = String(env[key] ?? "");
  if (value.length < minLength) throw new Error(`${key} must be at least ${minLength} characters in production`);
}

function validateUrl(value: unknown, key: string) {
  try {
    return new URL(String(value));
  } catch {
    throw new Error(`${key} must be a valid absolute URL`);
  }
}

function requireHttps(value: unknown, key: string) {
  const parsed = validateUrl(value, key);
  if (parsed.protocol !== "https:") throw new Error(`${key} must use HTTPS in production`);
}

export function validateEnvironment(input: Record<string, unknown>) {
  const env = { ...input } as Record<string, unknown>;

  if (!String(env.DATABASE_URL ?? "").trim()) throw new Error("DATABASE_URL is required");

  env.API_PORT = positiveInteger(env.API_PORT, "API_PORT", 3001);
  env.SESSION_TTL_DAYS = positiveInteger(env.SESSION_TTL_DAYS, "SESSION_TTL_DAYS", 30);
  env.TRUST_PROXY_HOPS = nonNegativeInteger(env.TRUST_PROXY_HOPS, "TRUST_PROXY_HOPS", 0);
  env.ERROR_REPORTING_TIMEOUT_MS = positiveInteger(env.ERROR_REPORTING_TIMEOUT_MS, "ERROR_REPORTING_TIMEOUT_MS", 1500);
  env.WORKER_HEARTBEAT_MAX_AGE_SECONDS = positiveInteger(env.WORKER_HEARTBEAT_MAX_AGE_SECONDS, "WORKER_HEARTBEAT_MAX_AGE_SECONDS", 120);

  env.RATE_LIMIT_LOGIN_IP_MAX = positiveInteger(env.RATE_LIMIT_LOGIN_IP_MAX, "RATE_LIMIT_LOGIN_IP_MAX", 12);
  env.RATE_LIMIT_LOGIN_IDENTITY_MAX = positiveInteger(env.RATE_LIMIT_LOGIN_IDENTITY_MAX, "RATE_LIMIT_LOGIN_IDENTITY_MAX", 8);
  env.RATE_LIMIT_LOGIN_WINDOW_SECONDS = positiveInteger(env.RATE_LIMIT_LOGIN_WINDOW_SECONDS, "RATE_LIMIT_LOGIN_WINDOW_SECONDS", 900);
  env.RATE_LIMIT_MFA_IP_MAX = positiveInteger(env.RATE_LIMIT_MFA_IP_MAX, "RATE_LIMIT_MFA_IP_MAX", 15);
  env.RATE_LIMIT_MFA_WINDOW_SECONDS = positiveInteger(env.RATE_LIMIT_MFA_WINDOW_SECONDS, "RATE_LIMIT_MFA_WINDOW_SECONDS", 600);
  env.RATE_LIMIT_WEBHOOK_IP_MAX = positiveInteger(env.RATE_LIMIT_WEBHOOK_IP_MAX, "RATE_LIMIT_WEBHOOK_IP_MAX", 180);
  env.RATE_LIMIT_WEBHOOK_WINDOW_SECONDS = positiveInteger(env.RATE_LIMIT_WEBHOOK_WINDOW_SECONDS, "RATE_LIMIT_WEBHOOK_WINDOW_SECONDS", 60);

  const webUrl = env.WEB_URL ?? "http://localhost:3000";
  validateUrl(webUrl, "WEB_URL");
  env.WEB_URL = String(webUrl).replace(/\/$/, "");
  const apiUrl = env.API_URL ?? "http://localhost:3001";
  validateUrl(apiUrl, "API_URL");
  env.API_URL = String(apiUrl).replace(/\/$/, "");

  const allowedOrigins = String(env.CORS_ALLOWED_ORIGINS ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  for (const [index, origin] of allowedOrigins.entries()) validateUrl(origin, `CORS_ALLOWED_ORIGINS[${index}]`);

  const logLevel = String(env.LOG_LEVEL ?? "log").toLowerCase();
  if (!["debug", "log", "warn", "error"].includes(logLevel)) throw new Error("LOG_LEVEL must be debug, log, warn or error");
  env.LOG_LEVEL = logLevel;

  const production = String(env.NODE_ENV ?? "development") === "production";
  env.RATE_LIMIT_ENABLED = booleanEnv(env.RATE_LIMIT_ENABLED, "RATE_LIMIT_ENABLED", production);
  env.STRICT_ORIGIN_CHECK_ENABLED = booleanEnv(env.STRICT_ORIGIN_CHECK_ENABLED, "STRICT_ORIGIN_CHECK_ENABLED", production);
  env.SECURITY_HEADERS_ENABLED = booleanEnv(env.SECURITY_HEADERS_ENABLED, "SECURITY_HEADERS_ENABLED", true);
  env.METRICS_ENABLED = booleanEnv(env.METRICS_ENABLED, "METRICS_ENABLED", false);

  if (production) {
    requireSecret(env, "APP_ENCRYPTION_KEY");
    requireSecret(env, "MFA_ENCRYPTION_KEY");
    requireSecret(env, "RATE_LIMIT_HASH_KEY");
    requireSecret(env, "LOG_HASH_KEY");
    requireHttps(env.WEB_URL, "WEB_URL");
    requireHttps(env.API_URL, "API_URL");
    if (env.METRICS_ENABLED) requireSecret(env, "METRICS_TOKEN");
  }

  const errorReportingUrl = String(env.ERROR_REPORTING_WEBHOOK_URL ?? "").trim();
  if (errorReportingUrl) {
    validateUrl(errorReportingUrl, "ERROR_REPORTING_WEBHOOK_URL");
    if (production) requireHttps(errorReportingUrl, "ERROR_REPORTING_WEBHOOK_URL");
  }

  const telegramToken = String(env.TELEGRAM_BOT_TOKEN ?? "").trim();
  if (telegramToken) {
    if (!String(env.TELEGRAM_BOT_USERNAME ?? "").trim()) {
      throw new Error("TELEGRAM_BOT_USERNAME is required when TELEGRAM_BOT_TOKEN is configured");
    }
    if (production && !String(env.TELEGRAM_WEBHOOK_SECRET ?? "").trim()) {
      throw new Error("TELEGRAM_WEBHOOK_SECRET is required with Telegram in production");
    }
  }

  if (String(env.SMTP_USER ?? "").trim() && !String(env.SMTP_PASSWORD ?? "").trim()) {
    throw new Error("SMTP_PASSWORD is required when SMTP_USER is configured");
  }

  const legacyPaymentProvider = String(env.PAYMENT_PROVIDER ?? "NONE").trim().toUpperCase();
  if (!["NONE", "LIQPAY", "MONO"].includes(legacyPaymentProvider)) {
    throw new Error("PAYMENT_PROVIDER must be NONE, LIQPAY or MONO");
  }
  env.PAYMENT_PROVIDER = legacyPaymentProvider;

  const defaultPaymentProvider = String(env.PAYMENT_DEFAULT_PROVIDER ?? legacyPaymentProvider).trim().toUpperCase();
  if (!["NONE", "LIQPAY", "MONO"].includes(defaultPaymentProvider)) {
    throw new Error("PAYMENT_DEFAULT_PROVIDER must be NONE, LIQPAY or MONO");
  }
  env.PAYMENT_DEFAULT_PROVIDER = defaultPaymentProvider;

  const liqPayEnabled = booleanEnv(env.LIQPAY_ENABLED, "LIQPAY_ENABLED", legacyPaymentProvider === "LIQPAY");
  const monoEnabled = booleanEnv(env.MONO_ENABLED, "MONO_ENABLED", legacyPaymentProvider === "MONO");
  env.LIQPAY_ENABLED = liqPayEnabled;
  env.MONO_ENABLED = monoEnabled;

  if (defaultPaymentProvider === "LIQPAY" && !liqPayEnabled) {
    throw new Error("PAYMENT_DEFAULT_PROVIDER=LIQPAY requires LIQPAY_ENABLED=true");
  }
  if (defaultPaymentProvider === "MONO" && !monoEnabled) {
    throw new Error("PAYMENT_DEFAULT_PROVIDER=MONO requires MONO_ENABLED=true");
  }

  if (liqPayEnabled) {
    if (!String(env.LIQPAY_PUBLIC_KEY ?? "").trim()) throw new Error("LIQPAY_PUBLIC_KEY is required when LiqPay is enabled");
    if (!String(env.LIQPAY_PRIVATE_KEY ?? "").trim()) throw new Error("LIQPAY_PRIVATE_KEY is required when LiqPay is enabled");
    if (!String(env.LIQPAY_CALLBACK_URL ?? "").trim()) throw new Error("LIQPAY_CALLBACK_URL is required when LiqPay is enabled");
    validateUrl(env.LIQPAY_CALLBACK_URL, "LIQPAY_CALLBACK_URL");
    if (production) requireHttps(env.LIQPAY_CALLBACK_URL, "LIQPAY_CALLBACK_URL");
    if (env.LIQPAY_RESULT_URL) validateUrl(env.LIQPAY_RESULT_URL, "LIQPAY_RESULT_URL");
    if (env.LIQPAY_API_URL) validateUrl(env.LIQPAY_API_URL, "LIQPAY_API_URL");
    if (env.LIQPAY_CHECKOUT_URL) validateUrl(env.LIQPAY_CHECKOUT_URL, "LIQPAY_CHECKOUT_URL");
  }

  if (monoEnabled) {
    if (!String(env.MONO_TOKEN ?? "").trim()) throw new Error("MONO_TOKEN is required when Monobank acquiring is enabled");
    if (!String(env.MONO_WEBHOOK_URL ?? "").trim()) throw new Error("MONO_WEBHOOK_URL is required when Monobank acquiring is enabled");
    validateUrl(env.MONO_WEBHOOK_URL, "MONO_WEBHOOK_URL");
    if (production) requireHttps(env.MONO_WEBHOOK_URL, "MONO_WEBHOOK_URL");
    if (env.MONO_RESULT_URL) validateUrl(env.MONO_RESULT_URL, "MONO_RESULT_URL");
    if (env.MONO_API_URL) validateUrl(env.MONO_API_URL, "MONO_API_URL");
    if (String(env.MONO_WEBHOOK_PUBLIC_KEY_BASE64 ?? "").trim()) {
      const decoded = Buffer.from(String(env.MONO_WEBHOOK_PUBLIC_KEY_BASE64), "base64").toString("utf8");
      if (!decoded.includes("BEGIN PUBLIC KEY")) {
        throw new Error("MONO_WEBHOOK_PUBLIC_KEY_BASE64 must contain a base64-encoded PEM public key");
      }
    }
  }

  return env;
}
