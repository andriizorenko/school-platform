import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const outDir = path.join(root, "artifacts");
fs.mkdirSync(outDir, { recursive: true });
const lockPath = path.join(root, "pnpm-lock.yaml");
if (!fs.existsSync(lockPath)) throw new Error("pnpm-lock.yaml is required for dependency audit");
const result = spawnSync("pnpm", ["audit", "--audit-level", "high", "--json"], { cwd: root, encoding: "utf8" });
let parsed = null;
try { parsed = JSON.parse(result.stdout || "null"); } catch { parsed = null; }
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const evidence = {
  formatVersion: 1,
  releaseSha: process.env.RELEASE_SHA || null,
  generatedAt: new Date().toISOString(),
  lockfileSha256: sha256(fs.readFileSync(lockPath)),
  command: "pnpm audit --audit-level high --json",
  exitCode: result.status,
  status: result.status === 0 ? "PASS" : "FAIL",
  report: parsed,
  stderr: String(result.stderr || "").slice(0, 8000),
};
if (!evidence.releaseSha) throw new Error("RELEASE_SHA is required for dependency audit evidence");
const output = path.join(outDir, "dependency-audit.json");
fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + "\n");
if (result.stdout) fs.writeFileSync(path.join(outDir, "dependency-audit.raw.json"), result.stdout);
console.log(`${output}: ${evidence.status}`);
if (result.status !== 0) {
  console.error("Dependency audit BLOCKED: high/critical production vulnerability or audit transport failure detected.");
  process.exit(result.status || 1);
}
