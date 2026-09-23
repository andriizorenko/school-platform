import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const failures = [];
const warnings = [];
const fail = (message) => failures.push(message);
const warn = (message) => warnings.push(message);

const rootPackage = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const lockfile = path.join(root, "pnpm-lock.yaml");
if (!fs.existsSync(lockfile)) {
  fail("pnpm-lock.yaml is missing. Generate it with `pnpm install --lockfile-only`, review it, commit it, then rerun this gate.");
} else {
  const lockText = fs.readFileSync(lockfile, "utf8");
  if (!/lockfileVersion:/.test(lockText) || !/^importers:/m.test(lockText)) fail("pnpm-lock.yaml does not look like a complete pnpm lockfile");
  for (const importer of [".", "apps/api", "apps/web", "apps/worker", "packages/db"]) {
    const escaped = importer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`^\\s{2}${escaped}:\\s*$`, "m").test(lockText)) fail(`pnpm-lock.yaml is missing importer: ${importer}`);
  }
  const hash = crypto.createHash("sha256").update(lockText).digest("hex");
  console.log(`lockfile sha256: ${hash}`);
  if (fs.existsSync(path.join(root, ".git")) && process.env.RELEASE_ALLOW_UNTRACKED_LOCKFILE !== "true") {
    const tracked = spawnSync("git", ["ls-files", "--error-unmatch", "pnpm-lock.yaml"], { cwd: root, encoding: "utf8" });
    if (tracked.status !== 0) {
      fail("pnpm-lock.yaml exists but is not committed/tracked by git");
    } else {
      const worktreeClean = spawnSync("git", ["diff", "--quiet", "HEAD", "--", "pnpm-lock.yaml"], { cwd: root });
      const indexClean = spawnSync("git", ["diff", "--cached", "--quiet", "HEAD", "--", "pnpm-lock.yaml"], { cwd: root });
      if (worktreeClean.status !== 0 || indexClean.status !== 0) fail("pnpm-lock.yaml must match committed HEAD before a release run");
    }
  }
}

const packageFiles = [
  "package.json",
  ...fs.readdirSync(path.join(root, "apps"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => `apps/${e.name}/package.json`).filter((f) => fs.existsSync(path.join(root, f))),
  ...fs.readdirSync(path.join(root, "packages"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => `packages/${e.name}/package.json`).filter((f) => fs.existsSync(path.join(root, f))),
];
for (const file of packageFiles) {
  const json = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const [name, version] of Object.entries(json[section] ?? {})) {
      const value = String(version).trim();
      if (value === "latest" || value === "*" || value.startsWith("http:") || value.startsWith("https:") || value.startsWith("git+")) {
        fail(`${file}: ${section}.${name} uses a non-release-safe dependency spec (${value})`);
      }
    }
  }
}

if (rootPackage.packageManager !== "pnpm@10.17.1") fail("packageManager must stay pinned to pnpm@10.17.1");
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor !== 22) fail(`release tooling requires Node 22; current Node is ${process.versions.node}`);

for (const forbidden of ["node_modules", ".next", "dist", "coverage"]) {
  const hits = [];
  function walk(dir, depth = 0) {
    if (depth > 3 || !fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name === forbidden) hits.push(path.relative(root, full));
      else if (entry.isDirectory()) walk(full, depth + 1);
    }
  }
  walk(root);
  if (hits.length) warn(`generated ${forbidden} directories exist: ${hits.slice(0, 5).join(", ")}`);
}

if (warnings.length) {
  console.warn(`Release preflight warnings (${warnings.length}):`);
  for (const item of warnings) console.warn(`- ${item}`);
}
if (failures.length) {
  console.error(`Release preflight BLOCKED (${failures.length}):`);
  for (const item of failures) console.error(`- ${item}`);
  process.exit(1);
}
console.log(`Release preflight passed (${packageFiles.length} package manifests checked).`);
