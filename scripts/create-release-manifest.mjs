import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = process.cwd();
const lockPath = path.join(root, "pnpm-lock.yaml");
if (!fs.existsSync(lockPath)) throw new Error("pnpm-lock.yaml is required before creating a release manifest");
const releaseSha = String(process.env.RELEASE_SHA || "").trim();
if (!releaseSha) throw new Error("RELEASE_SHA is required before creating a release manifest");
const outDir = path.join(root, "artifacts");
fs.mkdirSync(outDir, { recursive: true });
const excludedSegments = new Set([".git", "node_modules", ".next", "dist", "coverage", "test-results", "storage", "artifacts"]);
const files = [];
function shouldSkipEnv(name) {
  if (name === ".env.example" || name === ".env.staging.example") return false;
  return name === ".env" || name.startsWith(".env.");
}
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (excludedSegments.has(entry.name) || shouldSkipEnv(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile()) files.push(full);
  }
}
walk(root);
files.sort();
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const sourceHasher = crypto.createHash("sha256");
const fileHashes = [];
for (const file of files) {
  const relative = path.relative(root, file).replaceAll(path.sep, "/");
  const bytes = fs.readFileSync(file);
  const fileSha = sha256(bytes);
  sourceHasher.update(relative); sourceHasher.update("\0"); sourceHasher.update(fileSha); sourceHasher.update("\n");
  fileHashes.push({ path: relative, sha256: fileSha, bytes: bytes.length });
}
const migrations = fileHashes.filter((f) => /^packages\/db\/migrations\/\d+_.+\.sql$/.test(f.path));
const requiredEvidence = [
  "dependency-evidence.json",
  "dependency-audit.json",
  "image-evidence.json",
  "beta-acceptance-report.json",
];
const evidence = {};
for (const name of requiredEvidence) {
  const full = path.join(outDir, name);
  if (!fs.existsSync(full)) throw new Error(`Required release evidence is missing before manifest creation: artifacts/${name}`);
  const bytes = fs.readFileSync(full);
  evidence[name] = { sha256: sha256(bytes), bytes: bytes.length };
}
const manifest = {
  formatVersion: 2,
  releaseSha,
  generatedAt: new Date().toISOString(),
  node: process.versions.node,
  packageManager: JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).packageManager,
  sourceSha256: sourceHasher.digest("hex"),
  lockfileSha256: sha256(fs.readFileSync(lockPath)),
  migrationCount: migrations.length,
  fileCount: fileHashes.length,
  evidence,
  files: fileHashes,
};
const output = path.join(outDir, "release-manifest.json");
fs.writeFileSync(output, JSON.stringify(manifest, null, 2) + "\n");
console.log(`${output}: ${manifest.sourceSha256}`);
