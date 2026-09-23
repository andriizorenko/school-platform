# 0026 — Integration hardening

This pass intentionally adds very little product surface. Its purpose is to make the existing modular monolith safer to install, build, run and verify as one system.

## Runtime configuration

The Nest API now validates environment configuration on startup. `DATABASE_URL` is always required. Production requires strong `APP_ENCRYPTION_KEY` and `MFA_ENCRYPTION_KEY` values, and Telegram configuration is checked as one coherent feature rather than failing later during a user flow.

Root `.env` loading is normalized for package-level pnpm/turbo execution. The database migration/seed scripts and worker explicitly load the monorepo root `.env`, so `pnpm --filter ...` no longer depends on an accidental current working directory.

`NEXT_PUBLIC_API_URL` is documented in `.env.example`.

## Process lifecycle and readiness

The API enables Nest shutdown hooks and closes the PostgreSQL pool on application shutdown. `/api/health` remains a liveness endpoint, while `/api/health/ready` performs a real `SELECT 1` readiness check.

The worker handles `SIGINT`/`SIGTERM`, finishes the current iteration, exits its polling loop and closes the pool cleanly.

## Payroll consistency

Worker-created payroll periods now read `payroll_anchor_date`, `payroll_period_days` and `payroll_payout_window_days` from `school_settings`. This removes the previous integration drift where the API respected configurable payroll settings but the worker still materialized hard-coded 14/3-day periods.

## Build/test graph

Turbo now builds workspace dependencies before `dev`, `typecheck` and `test`. This is important because `@school/api` and `@school/worker` resolve the built `@school/db` package.

The API test runner now uses `tsx --test` / Node's built-in test API, matching the worker test strategy. The previous Jest command had no TypeScript transform configured and therefore was not a valid fresh-checkout test path.

## Static integration checks

`scripts/check-integration.mjs` validates repository-wide invariants without requiring a running database:

- contiguous migration numbering and basic SQL dependency order;
- relative import resolution;
- seeded permissions for permission references;
- seeded `school_settings` keys used by business logic;
- registered/audienced notification event types;
- duplicate Nest HTTP routes;
- documented environment variables;
- build-order and production-safety wiring.

Use:

```bash
pnpm verify:static
```

The full verification command after dependencies are installed is:

```bash
pnpm verify
```

## CI

`.github/workflows/ci.yml` provisions a clean PostgreSQL 17 service, installs dependencies, applies every migration, seeds minimum identities, runs static checks, typecheck, tests and production builds, then starts the built API and calls `/api/health/ready`.

The repository currently does not contain a generated `pnpm-lock.yaml` because dependency installation was unavailable in the authoring runtime. The first normal local install should generate and commit the lockfile; after that CI should switch from `--no-frozen-lockfile` to the default frozen-lockfile behavior.
