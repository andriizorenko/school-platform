import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const outDir = path.join(root, "artifacts");
fs.mkdirSync(outDir, { recursive: true });
const lockPath = path.join(root, "pnpm-lock.yaml");
if (!fs.existsSync(lockPath)) throw new Error("pnpm-lock.yaml is required for dependency evidence");
if (!fs.existsSync(path.join(root, "node_modules"))) throw new Error("node_modules is missing; run pnpm install --frozen-lockfile first");

function runStrict(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status}): ${(result.stderr || result.stdout || "").slice(0, 1000)}`);
  }
  return String(result.stdout || "").trim();
}
function sha256(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function countPackageNodes(value) {
  let count = 0;
  const seen = new Set();
  function walk(node) {
    if (!node || typeof node !== "object") return;
    const key = `${node.path || ""}|${node.name || ""}|${node.version || ""}`;
    if ((node.name || node.version) && !seen.has(key)) { seen.add(key); count += 1; }
    for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
      const deps = node[section];
      if (!deps) continue;
      if (Array.isArray(deps)) for (const child of deps) walk(child);
      else for (const child of Object.values(deps)) walk(child);
    }
  }
  if (Array.isArray(value)) for (const item of value) walk(item); else walk(value);
  return count;
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).filter((key) => key !== "path").sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

function collectReportedProblems(value) {
  const found = [];
  const seen = new Set();
  function walk(node, location = "$") {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    for (const [key, child] of Object.entries(node)) {
      const next = `${location}.${key}`;
      if ((key === "problems" || key === "peerDependencyIssues") && child) {
        const emptyArray = Array.isArray(child) && child.length === 0;
        const emptyObject = !Array.isArray(child) && typeof child === "object" && Object.keys(child).length === 0;
        if (!emptyArray && !emptyObject) found.push({ location: next, value: child });
      }
      if (child && typeof child === "object") walk(child, next);
    }
  }
  walk(value);
  return found;
}

const pnpmVersion = runStrict("pnpm", ["--version"]);
const listArgs = ["list", "--recursive", "--depth", "1000", "--json"];
const listResult = spawnSync("pnpm", listArgs, { cwd: root, encoding: "utf8" });
const listStdout = String(listResult.stdout || "");
const listStderr = String(listResult.stderr || "");
fs.writeFileSync(path.join(outDir, "dependency-list.raw.json"), listStdout);
fs.writeFileSync(path.join(outDir, "dependency-list.stderr.txt"), listStderr);

let tree;
try {
  tree = JSON.parse(listStdout || "[]");
} catch (error) {
  const evidence = {
    formatVersion: 1,
    status: "FAIL",
    releaseSha: process.env.RELEASE_SHA || null,
    generatedAt: new Date().toISOString(),
    nodeVersion: process.versions.node,
    pnpmVersion,
    lockfileSha256: sha256(fs.readFileSync(lockPath)),
    listExitCode: listResult.status,
    listParseError: error instanceof Error ? error.message : String(error),
    listStderr: listStderr.slice(0, 8000),
  };
  fs.writeFileSync(path.join(outDir, "dependency-evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
  throw new Error("pnpm list did not return valid JSON; diagnostic artifacts were written");
}

const reportedProblems = collectReportedProblems(tree);
const canonicalTree = canonicalize(tree);
const evidence = {
  formatVersion: 1,
  status: listResult.status === 0 && reportedProblems.length === 0 ? "PASS" : "FAIL",
  releaseSha: process.env.RELEASE_SHA || null,
  generatedAt: new Date().toISOString(),
  nodeVersion: process.versions.node,
  pnpmVersion,
  lockfileSha256: sha256(fs.readFileSync(lockPath)),
  packageTreeSha256: sha256(Buffer.from(JSON.stringify(canonicalTree))),
  packageNodeCount: countPackageNodes(tree),
  workspaceCount: Array.isArray(tree) ? tree.length : 1,
  listExitCode: listResult.status,
  reportedProblemCount: reportedProblems.length,
  reportedProblems: reportedProblems.slice(0, 100),
  listStderr: listStderr.slice(0, 8000),
};
if (!evidence.releaseSha) throw new Error("RELEASE_SHA is required for dependency evidence");
const output = path.join(outDir, "dependency-evidence.json");
fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + "\n");
console.log(`${output}: ${evidence.status} ${evidence.packageTreeSha256}`);

if (evidence.status !== "PASS") {
  throw new Error(
    `Dependency graph evidence blocked: pnpm list exit=${listResult.status}; reportedProblems=${reportedProblems.length}. Diagnostic artifacts were written.`,
  );
}
