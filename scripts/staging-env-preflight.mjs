import fs from "node:fs";
import path from "node:path";

const envFileArg = process.argv.find((arg) => arg.startsWith("--env-file="));
const envFile = path.resolve(envFileArg ? envFileArg.slice("--env-file=".length) : (process.env.STAGING_ENV_FILE || ".env.staging"));
const acceptanceMode = process.argv.includes("--acceptance") || process.env.STAGING_ACCEPTANCE_MODE === "true";

function parseEnv(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[match[1]] = value;
  }
  return out;
}

function assert(condition, message, failures) {
  if (!condition) failures.push(message);
}
function strongSecret(value) {
  return typeof value === "string" && value.length >= 32 && !/replace|change-me|example|secret$/i.test(value);
}
function isPlaceholder(value) {
  return !value || /replace-with|change-me|example|localhost|\.example(?:$|[:/])/i.test(value);
}
function url(value, name, failures) {
  try {
    return new URL(value);
  } catch {
    failures.push(`${name} must be a valid URL`);
    return null;
  }
}

if (!fs.existsSync(envFile)) {
  console.error(`Staging preflight BLOCKED: env file is missing: ${envFile}`);
  process.exit(1);
}

const env = parseEnv(fs.readFileSync(envFile, "utf8"));
const failures = [];
assert(env.NODE_ENV === "production", "NODE_ENV must be production", failures);
assert(["staging", "rc"].includes((env.APP_ENV || "").toLowerCase()), "APP_ENV must be staging or rc", failures);
assert(Boolean(env.RELEASE_SHA) && !isPlaceholder(env.RELEASE_SHA) && env.RELEASE_SHA !== "local", "RELEASE_SHA must identify the candidate build", failures);

const webUrl = url(env.WEB_URL, "WEB_URL", failures);
const apiUrl = url(env.API_URL, "API_URL", failures);
const publicApiUrl = url(env.NEXT_PUBLIC_API_URL, "NEXT_PUBLIC_API_URL", failures);
if (webUrl) {
  assert(webUrl.protocol === "https:", "WEB_URL must use HTTPS", failures);
  assert(env.WEB_HOST === webUrl.hostname, "WEB_HOST must match WEB_URL hostname", failures);
}
if (apiUrl) {
  assert(apiUrl.protocol === "https:", "API_URL must use HTTPS", failures);
  assert(env.API_HOST === apiUrl.hostname, "API_HOST must match API_URL hostname", failures);
}
if (apiUrl && publicApiUrl) {
  assert(publicApiUrl.protocol === "https:", "NEXT_PUBLIC_API_URL must use HTTPS", failures);
  assert(publicApiUrl.origin === apiUrl.origin && publicApiUrl.pathname.replace(/\/$/, "") === "/api", "NEXT_PUBLIC_API_URL must be API_URL + /api", failures);
}
assert(!isPlaceholder(env.TLS_ACME_EMAIL) && /@/.test(env.TLS_ACME_EMAIL || ""), "TLS_ACME_EMAIL must be configured", failures);
assert(!isPlaceholder(env.POSTGRES_PASSWORD), "POSTGRES_PASSWORD must not be a placeholder", failures);
assert(/staging|_rc|\brc\b/i.test(env.POSTGRES_DB || ""), "POSTGRES_DB must clearly identify a staging/RC database", failures);
for (const key of ["APP_ENCRYPTION_KEY", "MFA_ENCRYPTION_KEY", "RATE_LIMIT_HASH_KEY", "LOG_HASH_KEY", "METRICS_TOKEN"]) {
  assert(strongSecret(env[key]), `${key} must be a non-placeholder secret of at least 32 characters`, failures);
}
assert(env.STRICT_ORIGIN_CHECK_ENABLED === "true", "STRICT_ORIGIN_CHECK_ENABLED must be true", failures);
assert(env.SECURITY_HEADERS_ENABLED === "true", "SECURITY_HEADERS_ENABLED must be true", failures);
assert(env.RATE_LIMIT_ENABLED === "true", "RATE_LIMIT_ENABLED must be true", failures);
assert(env.METRICS_ENABLED === "true", "METRICS_ENABLED must be true", failures);
assert(Number(env.TRUST_PROXY_HOPS) >= 1, "TRUST_PROXY_HOPS must be at least 1 behind the staging proxy", failures);
assert(env.ACCEPTANCE_REQUIRE_HTTPS === "true", "ACCEPTANCE_REQUIRE_HTTPS must be true for staging", failures);
assert(env.ACCEPTANCE_REQUIRE_BACKUP !== "false", "ACCEPTANCE_REQUIRE_BACKUP must stay enabled", failures);

if (acceptanceMode) {
  assert(env.E2E_ALLOW_SEED === "true", "Acceptance mode requires E2E_ALLOW_SEED=true", failures);
  assert(env.E2E_ALLOW_STAGING_SEED === "true", "Acceptance mode requires E2E_ALLOW_STAGING_SEED=true", failures);
  for (const key of ["E2E_ADMIN_PASSWORD", "E2E_MANAGER_PASSWORD", "E2E_TEACHER_PASSWORD", "E2E_PARENT_PASSWORD", "E2E_STUDENT_PASSWORD"]) {
    assert(strongSecret(env[key]), `${key} must be a non-placeholder secret of at least 32 characters in acceptance mode`, failures);
  }
} else {
  assert(env.E2E_ALLOW_SEED !== "true", "Normal staging deployment must keep E2E_ALLOW_SEED disabled", failures);
  assert(env.E2E_ALLOW_STAGING_SEED !== "true", "Normal staging deployment must keep E2E_ALLOW_STAGING_SEED disabled", failures);
}

if (failures.length) {
  console.error(`Staging env preflight BLOCKED (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Staging env preflight passed (${acceptanceMode ? "acceptance" : "normal"} mode): ${envFile}`);
