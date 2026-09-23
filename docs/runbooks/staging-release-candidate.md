# Staging / release-candidate runbook

v33 treats staging as a release gate, not as an ad-hoc development environment.

## 1. Bootstrap and review the lockfile once

A release candidate is blocked until a reviewed `pnpm-lock.yaml` exists. Prefer the manual **Dependency Bootstrap** GitHub workflow described in `networked-release-bootstrap.md`, because it generates the lockfile, proves a frozen install, runs the high-severity dependency audit and uploads the dependency evidence bundle without auto-committing changes.

Local equivalent on a trusted networked machine:

```bash
pnpm lockfile:bootstrap
```

Commit the reviewed lockfile. CI and release images must never generate or mutate it. Real release preflight rejects a lockfile that exists locally but is not tracked by Git.

## 2. Local source verification

After the lockfile is committed:

```bash
pnpm release:preflight
pnpm install --frozen-lockfile
pnpm verify
```

`release:manifest` is intentionally **not** created at this point in v33. The final manifest requires dependency audit/tree evidence, beta acceptance evidence and Docker image evidence from the same `RELEASE_SHA`.

## 3. Configure staging

```bash
cp .env.staging.example .env.staging
```

Replace every placeholder secret. Use real HTTPS staging URLs. Set `RELEASE_SHA` to the immutable commit SHA being deployed.

Before Docker Compose is allowed to start, run:

```bash
pnpm staging:preflight
```

This checks host/URL consistency, non-placeholder secrets, HTTPS requirements, proxy/security flags, the staging database name and that E2E seed flags remain disabled for a normal staging deployment.

For a dedicated disposable acceptance database only, enable both E2E flags and run:

```bash
STAGING_ACCEPTANCE_MODE=true pnpm staging:preflight -- --acceptance
```

Never use acceptance mode against production.

## 4. Build immutable staging images

```bash
docker compose --env-file .env.staging -f docker-compose.staging.yml build --pull
```

Each application image refuses to build without `pnpm-lock.yaml`, installs with `--frozen-lockfile`, receives the same `RELEASE_SHA`, and exposes it through the OCI `org.opencontainers.image.revision` label.

## 5. Start dependencies and apply migrations once

```bash
docker compose --env-file .env.staging -f docker-compose.staging.yml up -d postgres redis

docker compose --env-file .env.staging -f docker-compose.staging.yml run --rm api pnpm db:migrate
```

Never run migrations concurrently from every API replica.

## 6. Start the release candidate

```bash
docker compose --env-file .env.staging -f docker-compose.staging.yml up -d api worker web caddy
```

Verify through the public TLS endpoints:

```bash
curl -fsS https://api.staging.school.example/api/health/ready
curl -fsS https://api.staging.school.example/api/health/worker
```

The API and worker must report the same `RELEASE_SHA`.

## 7. Run staging acceptance

From a trusted runner with the same candidate environment:

```bash
pnpm smoke:staging
pnpm acceptance:beta
```

The dedicated acceptance database may enable E2E seed flags as described above. `APP_ENV=production` remains blocked unconditionally by the E2E seed.

## 8. Backup / restore rehearsal

Before promoting a schema-changing release, take and verify a backup, restore the exact artifact into an isolated database and verify the migration history as described in `backup-restore.md`. Final beta acceptance must reference the verified backup file and SHA-256.

## 9. Candidate evidence

The Release Candidate workflow additionally generates:

```text
artifacts/dependency-audit.json
artifacts/dependency-evidence.json
artifacts/image-evidence.json
artifacts/beta-acceptance-report.json
artifacts/release-manifest.json
```

Then:

```bash
pnpm release:evidence
```

must pass. The verifier rejects a different release SHA, a different lockfile, failed dependency audit, substituted evidence file or an image whose OCI revision does not match the candidate.

## 10. Promotion decision

Promote only when all of the following are true:

- reviewed lockfile is committed;
- frozen install, typecheck, tests and build are green;
- dependency security audit is green at the configured high-severity threshold;
- all migrations apply to a fresh database;
- backup/restore drill is green;
- API and worker release SHA match;
- production + staging smoke gates are green;
- Admin → Manager → Teacher → Parent → Student E2E is green;
- no unresolved payment reconciliation event exists from the staging test set;
- all three container images are bound to the same release SHA;
- final release evidence verification is green;
- rollback target and backup artifact are identified.

## 11. Rollback

Application rollback is allowed only when the previous application is compatible with the already-applied schema. Database restore is an incident operation and requires the explicit restore confirmation described in `backup-restore.md`.
