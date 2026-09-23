import fs from "node:fs";
import path from "node:path";

const apiBase = (process.env.API_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
const webBase = (process.env.WEB_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const expectedRelease = String(process.env.RELEASE_SHA || "").trim();

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function cookieFrom(response) {
  const raw = response.headers.get("set-cookie");
  return raw ? raw.split(";", 1)[0] : "";
}
async function jsonRequest(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(7000), redirect: "manual" });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
  return { response, payload };
}

const health = await jsonRequest(`${apiBase}/api/health`);
assert(health.response.ok, `API health failed: ${health.response.status}`);
const worker = await jsonRequest(`${apiBase}/api/health/worker`);
assert(worker.response.ok, `Worker health failed: ${worker.response.status}`);
if (expectedRelease) {
  assert(health.payload?.releaseSha === expectedRelease, `API release mismatch: ${health.payload?.releaseSha}`);
  assert(worker.payload?.releaseSha === expectedRelease, `Worker release mismatch: ${worker.payload?.releaseSha}`);
}

const loginPage = await fetch(`${webBase}/login`, { signal: AbortSignal.timeout(7000), redirect: "manual" });
assert(loginPage.ok, `Web login page failed: ${loginPage.status}`);
if (process.env.ACCEPTANCE_REQUIRE_HTTPS === "true") {
  assert(apiBase.startsWith("https://"), "API_URL must use HTTPS for final staging acceptance");
  assert(webBase.startsWith("https://"), "WEB_URL must use HTTPS for final staging acceptance");
  assert(loginPage.headers.get("strict-transport-security"), "Web HSTS header is missing");
}

const managerLogin = await jsonRequest(`${apiBase}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: required("E2E_MANAGER_EMAIL"), password: required("E2E_MANAGER_PASSWORD") }),
});
assert(managerLogin.response.status === 201, `Manager acceptance login failed: ${managerLogin.response.status}`);
const cookie = cookieFrom(managerLogin.response);
assert(cookie, "Manager acceptance login did not set a session cookie");

const reconciliation = await jsonRequest(`${apiBase}/api/ops/payment-reconciliation?limit=100`, { headers: { cookie } });
assert(reconciliation.response.ok, `Payment reconciliation check failed: ${reconciliation.response.status}`);
assert(Array.isArray(reconciliation.payload), "Payment reconciliation payload is not an array");
assert(reconciliation.payload.length === 0, `Unresolved payment reconciliation events remain: ${reconciliation.payload.length}`);

const payments = await jsonRequest(`${apiBase}/api/ops/payments?limit=5`, { headers: { cookie } });
assert(payments.response.ok, `Payments operational check failed: ${payments.response.status}`);

const evidence = {
  checkedAt: new Date().toISOString(),
  releaseSha: health.payload?.releaseSha ?? null,
  workerReleaseSha: worker.payload?.releaseSha ?? null,
  apiUrl: apiBase,
  webUrl: webBase,
  unresolvedPaymentReconciliation: reconciliation.payload.length,
  sampledPayments: Array.isArray(payments.payload) ? payments.payload.length : null,
  httpsRequired: process.env.ACCEPTANCE_REQUIRE_HTTPS === "true",
  status: "PASS",
};
const output = process.env.ACCEPTANCE_FINAL_CHECK_OUTPUT?.trim();
if (output) {
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + "\n");
}
console.log(JSON.stringify(evidence));
