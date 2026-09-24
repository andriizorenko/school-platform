import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const lockPath = path.join(root, "pnpm-lock.yaml");
if (!fs.existsSync(lockPath)) throw new Error("pnpm-lock.yaml is required before creating a release manifest");
const releaseSha = String(process.env.RELEASE_SHA || "").trim();
if (!releaseSha) throw new Error("RELEASE_SHA is required before creating a release manifest");
const outDir = path.join(root, "artifacts");
fs.mkdirSync(outDir, { recursive: true });

const gitFiles = spawnSync("git", ["ls-files", "-z"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
});
if (gitFiles.status !== 0) {
  throw new Error(`git ls-files failed (${gitFiles.status}): ${gitFiles.stderr || gitFiles.stdout || ""}`);
}

const trackedFiles = String(gitFiles.stdout || "")
  .split("\0")
  .filter(Boolean)
  .sort();

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const sourceHasher = crypto.createHash("sha256");
const fileHashes = [];
for (const relative of trackedFiles) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
  const bytes = fs.readFileSync(full);
  const fileSha = sha256(bytes);
  sourceHasher.update(relative);
  sourceHasher.update("\0");
  sourceHasher.update(fileSha);
  sourceHasher.update("\n");
  fileHashes.push({ path: relative.replaceAll(path.sep, "/"), sha256: fileSha, bytes: bytes.length });
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
  sourceMode: "git-tracked",
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
