import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = process.cwd();
const evidenceDir = path.resolve(process.env.ACCEPTANCE_EVIDENCE_DIR || "artifacts/acceptance");
fs.mkdirSync(evidenceDir, { recursive: true });
const reportPath = path.resolve(process.env.ACCEPTANCE_REPORT || "artifacts/beta-acceptance-report.json");

async function sha256File(file) {
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

const report = {
  formatVersion: 1,
  releaseSha: process.env.RELEASE_SHA || null,
  appEnv: process.env.APP_ENV || null,
  nodeEnv: process.env.NODE_ENV || null,
  startedAt: new Date().toISOString(),
  apiUrl: process.env.API_URL || null,
  webUrl: process.env.WEB_URL || null,
  backupFile: process.env.ACCEPTANCE_BACKUP_FILE || null,
  steps: [],
  status: "RUNNING",
};

function failFast(message) {
  report.status = "BLOCKED";
  report.blockedReason = message;
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  throw new Error(message);
}

const lockfilePath = path.join(root, "pnpm-lock.yaml");
if (!fs.existsSync(lockfilePath)) failFast("pnpm-lock.yaml is required for final beta acceptance");
report.lockfileSha256 = await sha256File(lockfilePath);
if (process.env.ACCEPTANCE_BACKUP_FILE && fs.existsSync(process.env.ACCEPTANCE_BACKUP_FILE)) {
  report.backupSha256 = await sha256File(process.env.ACCEPTANCE_BACKUP_FILE);
}
if (!String(process.env.RELEASE_SHA || "").trim()) failFast("RELEASE_SHA is required for final beta acceptance");
if (!["staging", "rc"].includes(String(process.env.APP_ENV || "").toLowerCase())) failFast("APP_ENV must be staging or rc for final beta acceptance");
if (process.env.E2E_ALLOW_SEED !== "true") failFast("E2E_ALLOW_SEED=true is required for final beta acceptance");
if (process.env.NODE_ENV === "production" && process.env.E2E_ALLOW_STAGING_SEED !== "true") failFast("E2E_ALLOW_STAGING_SEED=true is required when acceptance runs in production-mode staging");
if (process.env.ACCEPTANCE_REQUIRE_BACKUP !== "false" && !process.env.ACCEPTANCE_BACKUP_FILE) failFast("ACCEPTANCE_BACKUP_FILE is required; take and verify a backup before final beta acceptance");

function runStep(name, command, args = [], extraEnv = {}) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
  });
  const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const logPath = path.join(evidenceDir, `${String(report.steps.length + 1).padStart(2, "0")}-${safeName}.log`);
  const combined = `${result.stdout || ""}${result.stderr || ""}`;
  fs.writeFileSync(logPath, combined);
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  const step = {
    name,
    command: [command, ...args].join(" "),
    status: result.status === 0 ? "PASS" : "FAIL",
    exitCode: result.status,
    durationMs: Date.now() - started,
    log: path.relative(root, logPath).replaceAll(path.sep, "/"),
  };
  report.steps.push(step);
  if (result.status !== 0) throw new Error(`${name} failed with exit code ${result.status}`);
}

try {
  runStep("Release preflight", "pnpm", ["release:preflight"]);
  if (process.env.ACCEPTANCE_BACKUP_FILE) {
    runStep("Backup verification", "pnpm", ["verify:backup"], { BACKUP_FILE: process.env.ACCEPTANCE_BACKUP_FILE });
  }
  runStep("Staging smoke", "pnpm", ["smoke:staging"]);
  runStep("Seed deterministic roles", "pnpm", ["db:seed:e2e"]);
  runStep("API roles and payment flow", "pnpm", ["e2e:api"]);
  runStep("Reset deterministic browser state", "pnpm", ["db:seed:e2e"]);
  runStep("Browser role flow", "pnpm", ["e2e:web"]);
  runStep("Final beta go-no-go check", "node", ["scripts/final-beta-check.mjs"], {
    ACCEPTANCE_FINAL_CHECK_OUTPUT: path.join(evidenceDir, "final-beta-check.json"),
  });
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  report.durationMs = new Date(report.finishedAt).getTime() - new Date(report.startedAt).getTime();
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(`Final beta acceptance: ${report.status}. Evidence: ${path.relative(root, reportPath)}`);
}
