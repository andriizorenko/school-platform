# Production deployment runbook

Before production promotion, complete `docs/runbooks/staging-release-candidate.md` and `docs/runbooks/final-beta-acceptance.md`; retain the release manifest, backup/restore evidence and beta acceptance report.

## Pre-deploy

1. A generated and reviewed `pnpm-lock.yaml` must be committed. Once it exists, CI should install with `pnpm install --frozen-lockfile`; do not perform a real production deployment from an unlocked dependency graph.
2. CI must be green: static checks, migrations, typecheck, unit tests, builds, API E2E and Playwright role E2E.
3. Take and verify a PostgreSQL backup before a schema-changing release.
4. Confirm `WEB_URL`, `API_URL`, payment callbacks and error-reporting URLs are HTTPS.
5. Confirm `RATE_LIMIT_HASH_KEY`, `LOG_HASH_KEY`, encryption keys and metrics token come from the secret manager.
6. Set `TRUST_PROXY_HOPS` to the exact number of trusted reverse proxies. Do not guess this value.

## Deploy

1. Deploy the API/worker/web image from the immutable release artifact.
2. Apply migrations once.
3. Start API and wait for `/api/health/live`, then `/api/health/ready`.
4. Start worker and web.
5. Run `pnpm smoke:production` against the public URLs.
6. Check 5xx rate, request latency, DB readiness and rate-limit rejection counters before opening normal traffic.

## Rollback

Application rollback is safe only when the previous version is compatible with the already-applied schema. Never edit an applied migration. If a release requires database recovery, use the backup/restore runbook as an incident operation rather than silently rolling the schema backward.

## Immediate post-deploy checks

- Login and MFA for a privileged test user.
- Parent checkout config loads but no real payment is initiated unless explicitly approved.
- Payment webhook endpoints reject invalid signatures.
- Telegram webhook rejects an invalid secret.
- `/api/metrics` is not publicly readable without its configured token.
