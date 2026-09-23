const apiBase = (process.env.API_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
const webBase = (process.env.WEB_URL || "http://127.0.0.1:3000").replace(/\/$/, "");

async function request(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(5000), redirect: "manual" });
  return response;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function requireHeaders(response, names, label) {
  for (const name of names) assert(response.headers.get(name), `${label}: missing ${name}`);
}

const live = await request(`${apiBase}/api/health/live`);
assert(live.ok, `API liveness failed: HTTP ${live.status}`);
const liveJson = await live.json();
assert(liveJson.status === "live", "API liveness payload is invalid");
requireHeaders(live, ["x-content-type-options", "x-frame-options", "referrer-policy", "x-request-id"], "API");

const ready = await request(`${apiBase}/api/health/ready`);
assert(ready.ok, `API readiness failed: HTTP ${ready.status}`);
const readyJson = await ready.json();
assert(readyJson.status === "ready" && readyJson.database === "ok", "API readiness payload is invalid");

const web = await request(`${webBase}/login`);
assert(web.ok, `Web login page failed: HTTP ${web.status}`);
requireHeaders(web, ["content-security-policy", "x-content-type-options", "x-frame-options", "referrer-policy"], "Web");

if (process.env.SMOKE_EXPECT_HSTS === "true") {
  requireHeaders(live, ["strict-transport-security"], "API");
  requireHeaders(web, ["strict-transport-security"], "Web");
}

if (process.env.STRICT_ORIGIN_CHECK_ENABLED === "true") {
  const rejected = await request(`${apiBase}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://malicious.invalid", "x-forwarded-for": "203.0.113.88" },
    body: JSON.stringify({ email: "origin-smoke@example.invalid", password: "not-a-real-password" }),
  });
  assert(rejected.status === 403, `Origin protection expected HTTP 403, got ${rejected.status}`);
}

if (process.env.SMOKE_TEST_RATE_LIMIT === "true") {
  let limited = false;
  for (let index = 0; index < 20; index += 1) {
    const response = await request(`${apiBase}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.99" },
      body: JSON.stringify({ email: "rate-limit-smoke@example.invalid", password: "not-a-real-password" }),
    });
    if (response.status === 429) {
      limited = true;
      assert(response.headers.get("retry-after"), "Rate-limit response is missing Retry-After");
      break;
    }
  }
  assert(limited, "Rate-limit smoke did not reach HTTP 429");
}

if (process.env.METRICS_ENABLED === "true") {
  const token = process.env.METRICS_TOKEN || "";
  const metrics = await request(`${apiBase}/api/metrics`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  assert(metrics.ok, `Metrics endpoint failed: HTTP ${metrics.status}`);
  const text = await metrics.text();
  assert(text.includes("school_process_uptime_seconds"), "Metrics payload is missing process uptime");
  assert(text.includes("school_http_requests_total"), "Metrics payload is missing HTTP counter");
}

console.log("Production smoke: PASS");
