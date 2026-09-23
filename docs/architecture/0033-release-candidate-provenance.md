# 0033 — Release Candidate dependency and image provenance

## Context

v32 could bind source, lockfile, backup and acceptance evidence, but the repository still lacked a safe networked path for creating the first lockfile and did not bind the built container images or resolved dependency graph to the same release identity.

## Decision

v33 treats a candidate as one evidence set identified by `RELEASE_SHA` and the SHA-256 of `pnpm-lock.yaml`.

The evidence set contains:

- `dependency-evidence.json` — resolved pnpm package-tree hash, Node/pnpm versions and lockfile hash;
- `dependency-audit.json` — dependency security audit result and lockfile hash;
- `beta-acceptance-report.json` — role/payment/browser/backup acceptance evidence;
- `image-evidence.json` — API/worker/web image IDs and OCI revision labels;
- `release-manifest.json` — source hash plus hashes of all evidence files.

The final verifier rejects mismatched release SHAs, mismatched lockfile hashes, failed dependency audit, incomplete image evidence, substituted evidence files or missing backup acceptance.

## Lockfile bootstrap

A separate manual networked workflow generates the lockfile from package manifests, immediately proves a frozen install, executes the production audit/static checks and uploads a review bundle. It does not auto-commit dependency changes.

## Image identity

All release Dockerfiles accept `RELEASE_SHA`, set it as the runtime default and write it to `org.opencontainers.image.revision`. The Release Candidate workflow builds all three images with the Git SHA and records `docker image inspect` evidence.

## Staging configuration

A dependency-free staging env preflight validates HTTPS hosts, secrets, release identity, proxy/security settings and safe E2E flags before Docker Compose is started. Normal staging refuses E2E seed flags; acceptance mode requires both explicit flags and a clearly staging/RC database name.

## Consequence

An offline source ZIP still cannot truthfully claim a green release without registry/Docker/PostgreSQL access, but the first networked run now has a deterministic path from package manifests to reviewed lockfile, frozen install, audit, candidate images and cryptographically bound release evidence.
