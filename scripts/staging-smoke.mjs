const apiUrl = (process.env.API_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
const expectedRelease = String(process.env.RELEASE_SHA || "").trim();

async function getJson(path) {
  const response = await fetch(`${apiUrl}${path}`, { headers: { "x-request-id": `staging-smoke-${Date.now()}` } });
  const body = await response.text();
  let json;
  try { json = JSON.parse(body); } catch { json = { raw: body }; }
  if (!response.ok) throw new Error(`${path} -> ${response.status}: ${body.slice(0, 500)}`);
  return json;
}

const health = await getJson("/api/health");
const ready = await getJson("/api/health/ready");
const worker = await getJson("/api/health/worker");
if (ready.status !== "ready") throw new Error("API readiness did not report ready");
if (worker.status !== "ready") throw new Error("Worker heartbeat did not report ready");
if (expectedRelease && health.releaseSha !== expectedRelease) {
  throw new Error(`API release mismatch: expected ${expectedRelease}, got ${health.releaseSha}`);
}
if (expectedRelease && worker.releaseSha !== expectedRelease) {
  throw new Error(`Worker release mismatch: expected ${expectedRelease}, got ${worker.releaseSha}`);
}
console.log(`Staging smoke passed: API + worker ready${expectedRelease ? ` @ ${expectedRelease}` : ""}.`);
