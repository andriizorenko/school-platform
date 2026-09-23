# v30 — Production security, observability and recovery

v30 does not add business domains. It hardens the existing v29 platform for controlled production rollout.

## Perimeter security

- The API removes `X-Powered-By`, emits baseline browser security headers, and enables HSTS in production.
- The web app emits CSP, `frame-ancestors 'none'`, `nosniff`, strict referrer policy and a restrictive Permissions Policy.
- Mutating API requests with an `Origin` header are rejected unless the exact origin is `WEB_URL` or one of `CORS_ALLOWED_ORIGINS`.
- Production URLs and enabled payment callback URLs must be HTTPS.
- `TRUST_PROXY_HOPS` must match the real reverse-proxy chain before trusting `X-Forwarded-For`.

The CSP intentionally allows inline script/style because the current Next.js application is not yet nonce-based. It still constrains all other resource categories and framing. Moving to nonce-based CSP can be a later hardening step after deployment infrastructure is fixed.

## Distributed rate limiting

Sensitive public endpoints are protected by PostgreSQL-backed fixed windows so limits are shared across API replicas:

- login: per client IP and per hashed `(IP,email)` identity;
- MFA verify/enable: per client IP;
- LiqPay, Monobank and Telegram callbacks: separate retry-friendly per-IP windows.

No raw IP or email is stored in the limiter table. Bucket subjects use an HMAC keyed by `RATE_LIMIT_HASH_KEY`. In production, a limiter database failure fails closed for protected endpoints.

## Structured logs and error reporting

The API uses JSON logs with request id, method, path, status, duration and an optional anonymized client hash. Bodies, cookies and authorization headers are not logged. Common credential-like keys and bearer values are redacted defensively.

Unhandled 5xx errors increment metrics and may be forwarded to `ERROR_REPORTING_WEBHOOK_URL`. Only redacted operational metadata is sent; no request body is included.

## Metrics and health

- `/api/health/live`: process liveness;
- `/api/health/ready`: PostgreSQL readiness and latency;
- `/api/metrics`: Prometheus text format when `METRICS_ENABLED=true`; protect it with `METRICS_TOKEN` in production.

Current metrics intentionally avoid user-, route-id- or entity-id labels to prevent high-cardinality/PPI leakage.

## Recovery and deployment gates

The repository contains:

- `scripts/backup-postgres.sh` — PostgreSQL custom-format backup plus SHA-256 sidecar;
- `scripts/verify-postgres-backup.sh` — checksum and `pg_restore --list` validation;
- `scripts/restore-postgres.sh` — explicit destructive restore gate; production restore requires a second acknowledgement;
- `scripts/production-smoke.mjs` — liveness/readiness, security headers, origin protection, optional limiter and metrics smoke.

Operational procedures are in `docs/runbooks/backup-restore.md` and `docs/runbooks/deployment.md`.

## Dependency baseline

The root toolchain no longer uses `latest`. v30 pins Turbo `2.11.2`, TypeScript `5.9.2`, Playwright `1.63.0`, and Next.js `15.5.26`. The Next.js version is the September 22, 2026 Maintenance LTS hardening release. A generated `pnpm-lock.yaml` is still required before the first real production deployment; this authoring environment cannot generate it because the npm registry is unreachable.
