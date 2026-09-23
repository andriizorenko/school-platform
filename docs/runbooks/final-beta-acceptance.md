# Final beta acceptance / go-no-go runbook

This is the last staging gate before production promotion. Run it only against a dedicated staging/RC database. Never run deterministic E2E seeding against production.

## 1. Required release identity

A reviewed `pnpm-lock.yaml` must be committed and `RELEASE_SHA` must identify the immutable source/image being tested.

```bash
pnpm release:preflight
```

## 2. Public TLS staging

Point DNS for `WEB_HOST` and `API_HOST` at the staging host and allow inbound TCP 80/443 (and UDP 443 if HTTP/3 is desired). Configure:

```text
WEB_HOST=staging.school.example
WEB_URL=https://staging.school.example
API_HOST=api.staging.school.example
API_URL=https://api.staging.school.example
NEXT_PUBLIC_API_URL=https://api.staging.school.example/api
TLS_ACME_EMAIL=ops@school.example
TRUST_PROXY_HOPS=1
```

`docker-compose.staging.yml` includes the pinned Caddy reverse proxy and persists its ACME state in named volumes.

## 3. Backup / restore evidence

Before acceptance, take and verify a database backup and rehearse a restore into an isolated database. Keep the verified dump path:

```bash
BACKUP_DIR=/secure/staging-backups pnpm backup:db
BACKUP_FILE=/secure/staging-backups/school-....dump pnpm verify:backup
```

Use the restore procedure in `backup-restore.md` and verify the restored migration count before continuing.

## 4. Explicit staging E2E acknowledgement

For a production-mode staging deployment only:

```text
NODE_ENV=production
APP_ENV=staging
E2E_ALLOW_SEED=true
E2E_ALLOW_STAGING_SEED=true
```

The seed remains hard-blocked when `APP_ENV=production`.

Provide isolated E2E identities through the `E2E_*` variables. Do not reuse employee/customer accounts.

## 5. Payment test environment

The full API acceptance includes LiqPay + mono success/refund/idempotency/reconciliation cases. Run it with dedicated provider test credentials or the repository mocks wired into the RC environment. Do not use live customer charges for routine acceptance.

## 6. Run the one-shot gate

```bash
ACCEPTANCE_BACKUP_FILE=/secure/staging-backups/school-....dump \
ACCEPTANCE_REQUIRE_HTTPS=true \
pnpm acceptance:beta
```

The gate performs:

1. release preflight;
2. backup artifact verification;
3. production + staging smoke;
4. deterministic Admin/Manager/Teacher/Parent/Student seed;
5. API RBAC + LiqPay + mono flow;
6. browser role flow;
7. final API/worker release parity check;
8. unresolved payment reconciliation count = 0.

Evidence is written to:

```text
artifacts/beta-acceptance-report.json
artifacts/acceptance/*.log
artifacts/acceptance/final-beta-check.json
```

v33 does not create the final manifest immediately after acceptance. The Release Candidate workflow first records dependency audit/tree evidence and builds the three release images with the same `RELEASE_SHA`, then records `image-evidence.json`, creates `release-manifest.json`, and finally runs `pnpm release:evidence`. The final verifier requires matching release SHA/lockfile identity across dependency evidence, audit and acceptance, matching OCI revision labels on API/Web/Worker images, backup evidence, and exact hashes of the evidence files recorded in the manifest.

## 7. Payment reconciliation rule

The API E2E intentionally creates a late successful payment for a cancelled checkout. That event must appear in the reconciliation queue, must not grant lesson credits, and must then be explicitly resolved by an authorized staff user. Final acceptance fails if any unresolved non-benign provider event remains.

In the UI use **Manager → Payments → Payment provider reconciliation**. Before clicking **Verified**, compare the provider transaction, order status, refund state and lesson-credit balance. The resolution is audit logged.

## 8. Go / no-go

**GO** requires all of the following:

- reviewed lockfile + frozen install;
- full CI and RC workflow green;
- dependency audit/tree evidence retained;
- API/Web/Worker image evidence retained and bound to the candidate SHA;
- release manifest + final evidence verification retained;
- verified backup and successful isolated restore rehearsal;
- public HTTPS + HSTS smoke green;
- API and worker report the exact same `RELEASE_SHA`;
- all five role flows green;
- LiqPay and mono acceptance green in a non-production payment environment;
- unresolved payment reconciliation = 0;
- rollback image and backup recovery point identified.

Any failed item is **NO-GO**. Do not waive failed finance, backup, release-identity or security gates by editing the acceptance report.
