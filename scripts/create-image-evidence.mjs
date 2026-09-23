import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const releaseSha = String(process.env.RELEASE_SHA || "").trim();
if (!releaseSha) throw new Error("RELEASE_SHA is required for image evidence");
const imageNames = String(process.env.RELEASE_IMAGES || `school-api:${releaseSha},school-worker:${releaseSha},school-web:${releaseSha}`)
  .split(",").map((x) => x.trim()).filter(Boolean);
if (imageNames.length !== 3) throw new Error(`Expected three release images, got ${imageNames.length}`);
const images = [];
for (const name of imageNames) {
  const result = spawnSync("docker", ["image", "inspect", name], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`docker image inspect failed for ${name}: ${(result.stderr || result.stdout || "").slice(0, 1000)}`);
  const inspected = JSON.parse(result.stdout)[0];
  const labels = inspected?.Config?.Labels || {};
  if (labels["org.opencontainers.image.revision"] !== releaseSha) {
    throw new Error(`${name} revision label mismatch: ${labels["org.opencontainers.image.revision"] || "missing"}`);
  }
  images.push({
    name,
    id: inspected.Id,
    repoDigests: inspected.RepoDigests || [],
    created: inspected.Created,
    os: inspected.Os,
    architecture: inspected.Architecture,
    revision: labels["org.opencontainers.image.revision"],
    title: labels["org.opencontainers.image.title"] || null,
  });
}
const canonical = JSON.stringify(images);
const evidence = {
  formatVersion: 1,
  status: "PASS",
  releaseSha,
  generatedAt: new Date().toISOString(),
  imageSetSha256: crypto.createHash("sha256").update(canonical).digest("hex"),
  images,
};
const outDir = path.join(root, "artifacts");
fs.mkdirSync(outDir, { recursive: true });
const output = path.join(outDir, "image-evidence.json");
fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + "\n");
console.log(`${output}: ${evidence.imageSetSha256}`);
