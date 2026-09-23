import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const outDir = path.join(root, "artifacts");
fs.mkdirSync(outDir, { recursive: true });
const lockPath = path.join(root, "pnpm-lock.yaml");
if (!fs.existsSync(lockPath)) throw new Error("pnpm-lock.yaml is required for dependency audit");

const args = ["audit", "--json"];
const result = spawnSync("pnpm", args, {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
});
const stdout = String(result.stdout || "");
const stderr = String(result.stderr || "");

let parsed = null;
let parseError = null;
try {
  parsed = JSON.parse(stdout || "null");
} catch (error) {
  parseError = error instanceof Error ? error.message : String(error);
}

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const advisories = parsed?.advisories && typeof parsed.advisories === "object"
  ? Object.values(parsed.advisories)
  : [];
const severityCounts = parsed?.metadata?.vulnerabilities && typeof parsed.metadata.vulnerabilities === "object"
  ? parsed.metadata.vulnerabilities
  : advisories.reduce((acc, advisory) => {
      const severity = String(advisory?.severity || "unknown").toLowerCase();
      acc[severity] = (acc[severity] || 0) + 1;
      return acc;
    }, {});

const blockingAdvisories = advisories.filter((advisory) => {
  const severity = String(advisory?.severity || "").toLowerCase();
  return severity === "high" || severity === "critical";
});
const reportError = parsed?.error || null;
const transportFailure = Boolean(result.error || result.signal || parseError || reportError || !parsed);
const status = !transportFailure && blockingAdvisories.length === 0 ? "PASS" : "FAIL";

const evidence = {
  formatVersion: 2,
  releaseSha: process.env.RELEASE_SHA || null,
  generatedAt: new Date().toISOString(),
  lockfileSha256: sha256(fs.readFileSync(lockPath)),
  command: "pnpm audit --json",
  gateThreshold: "high",
  exitCode: result.status,
  signal: result.signal || null,
  status,
  vulnerabilityCounts: severityCounts,
  blockingAdvisoryCount: blockingAdvisories.length,
  blockingAdvisoryIds: blockingAdvisories.map((advisory) => advisory?.github_advisory_id || advisory?.id || null),
  transportFailure,
  parseError,
  reportError,
  report: parsed,
  stderr: stderr.slice(0, 8000),
};
if (!evidence.releaseSha) throw new Error("RELEASE_SHA is required for dependency audit evidence");

const output = path.join(outDir, "dependency-audit.json");
fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + "\n");
if (stdout) fs.writeFileSync(path.join(outDir, "dependency-audit.raw.json"), stdout);
console.log(`${output}: ${evidence.status} (high=${severityCounts.high || 0}, critical=${severityCounts.critical || 0}, moderate=${severityCounts.moderate || 0})`);

if (status !== "PASS") {
  if (transportFailure) {
    console.error("Dependency audit BLOCKED: audit transport/parse/report failure.");
  } else {
    console.error(`Dependency audit BLOCKED: ${blockingAdvisories.length} high/critical advisories detected.`);
  }
  process.exit(1);
}
