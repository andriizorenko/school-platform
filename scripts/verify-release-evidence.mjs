import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = process.cwd();
const artifacts = path.resolve(process.env.RELEASE_ARTIFACTS_DIR || "artifacts");
const manifestPath = path.resolve(process.env.RELEASE_MANIFEST_PATH || path.join(artifacts, "release-manifest.json"));
const acceptancePath = path.resolve(process.env.ACCEPTANCE_REPORT || path.join(artifacts, "beta-acceptance-report.json"));
const dependencyPath = path.resolve(process.env.DEPENDENCY_EVIDENCE_PATH || path.join(artifacts, "dependency-evidence.json"));
const auditPath = path.resolve(process.env.DEPENDENCY_AUDIT_PATH || path.join(artifacts, "dependency-audit.json"));
const imagePath = path.resolve(process.env.IMAGE_EVIDENCE_PATH || path.join(artifacts, "image-evidence.json"));

function readJson(file, label) {
  if (!fs.existsSync(file)) throw new Error(`${label} is missing: ${file}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function assert(condition, message) { if (!condition) throw new Error(message); }
function sha256(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }

const manifest = readJson(manifestPath, "Release manifest");
const acceptance = readJson(acceptancePath, "Beta acceptance report");
const dependency = readJson(dependencyPath, "Dependency evidence");
const audit = readJson(auditPath, "Dependency audit evidence");
const images = readJson(imagePath, "Docker image evidence");

assert(manifest.formatVersion >= 2, `Release manifest format is too old: ${manifest.formatVersion}`);
assert(acceptance.status === "PASS", `Beta acceptance is not PASS: ${acceptance.status}`);
assert(Array.isArray(acceptance.steps) && acceptance.steps.length >= 7, "Beta acceptance does not contain the expected step evidence");
assert(acceptance.steps.every((step) => step.status === "PASS"), "At least one beta acceptance step is not PASS");
assert(dependency.status === "PASS", `Dependency evidence is not PASS: ${dependency.status}`);
assert(audit.status === "PASS" && audit.exitCode === 0, `Dependency audit is not PASS: ${audit.status}/${audit.exitCode}`);
assert(images.status === "PASS" && Array.isArray(images.images) && images.images.length === 3, "Docker image evidence is incomplete");
assert(Boolean(manifest.releaseSha), "Release manifest has no RELEASE_SHA");
for (const [label, value] of [["acceptance", acceptance.releaseSha], ["dependency", dependency.releaseSha], ["audit", audit.releaseSha], ["images", images.releaseSha]]) {
  assert(value === manifest.releaseSha, `Release SHA mismatch for ${label}: manifest=${manifest.releaseSha} evidence=${value}`);
}
assert(Boolean(manifest.lockfileSha256), "Release manifest has no lockfile hash");
for (const [label, value] of [["acceptance", acceptance.lockfileSha256], ["dependency", dependency.lockfileSha256], ["audit", audit.lockfileSha256]]) {
  assert(value === manifest.lockfileSha256, `Lockfile SHA mismatch for ${label}`);
}
if (process.env.ACCEPTANCE_REQUIRE_BACKUP !== "false") {
  assert(Boolean(acceptance.backupFile), "Beta acceptance is missing backup evidence");
  assert(Boolean(acceptance.backupSha256), "Beta acceptance is missing backup SHA-256");
}
assert(Number(manifest.migrationCount) >= 54, `Release manifest has unexpected migration count: ${manifest.migrationCount}`);
for (const [name, file] of [
  ["dependency-evidence.json", dependencyPath],
  ["dependency-audit.json", auditPath],
  ["image-evidence.json", imagePath],
  ["beta-acceptance-report.json", acceptancePath],
]) {
  const entry = manifest.evidence?.[name];
  assert(Boolean(entry?.sha256), `Release manifest is missing evidence hash for ${name}`);
  assert(entry.sha256 === sha256(file), `Release manifest evidence hash mismatch for ${name}`);
}
for (const image of images.images) {
  assert(image.revision === manifest.releaseSha, `Image revision mismatch for ${image.name}`);
}
console.log(`Release evidence verified: ${manifest.releaseSha} / ${manifest.lockfileSha256} / images=${images.imageSetSha256}`);
