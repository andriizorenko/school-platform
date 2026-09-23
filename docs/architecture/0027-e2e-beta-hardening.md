# 0027 — E2E beta hardening

This slice turns the primary role journey into an executable beta gate instead of relying on manual spot checks.

## Deterministic E2E fixture

`packages/db/src/seed-e2e.ts` creates an isolated set of test identities for:

- Admin;
- Manager;
- Teacher;
- Parent;
- Student.

The fixture also creates the minimum linked domain graph needed for meaningful portal checks: manager and teacher profiles, one family, one parent profile, one student profile, one active subject enrollment, a primary teacher assignment and a primary manager assignment.

The seed is idempotent for its dedicated E2E identities. It clears sessions for those identities before a run and resets the E2E Admin MFA state so the first-time MFA setup path is exercised rather than bypassed. It is intended for disposable development/CI databases only.

Run it with:

```bash
pnpm db:seed:e2e
```

The seed refuses to run with `NODE_ENV=production` and also requires the explicit `E2E_ALLOW_SEED=true` acknowledgement. This original v27 rule is superseded for dedicated production-mode staging/RC by ADR 0032; `APP_ENV=production` remains blocked. All `E2E_*_EMAIL` and `E2E_*_PASSWORD` variables are required and documented in `.env.example`.

## API vertical flow

`tests/e2e/api-flow.mjs` runs against the real HTTP API and verifies the vertical chain:

```text
Admin → Manager → Teacher → Parent → Student
```

The flow covers:

- database readiness;
- anonymous-session rejection;
- invalid-password rejection;
- role login and session cookies;
- Admin MFA setup, TOTP enablement and MFA enforcement;
- Admin access to protected settings/dashboard;
- Manager dashboard access and settings denial;
- Teacher self-profile/student access and settings denial;
- Parent dashboard with a linked student plus rejection from the Student portal;
- Student dashboard with an active enrollment plus rejection from the Parent portal;
- operations/RBAC denials for parent/student roles;
- logout and revoked-session rejection.

Run it while the API is running:

```bash
pnpm e2e:api
```

## Browser smoke flow

Playwright is configured in `playwright.config.ts`. The browser suite performs real UI login and navigation for all five roles. The Admin browser path completes first-time MFA using the secret displayed by the actual setup screen; no test-only authentication bypass is added to the application.

The smoke checks verify role landing pages, role shell identity, absence of page-level errors on the tested surfaces, linked parent/student fixture data and representative navigation. A Manager attempting to open Admin settings is redirected back to the Manager home by the existing role shell.

Run it after reseeding E2E state and starting API + web:

```bash
pnpm db:seed:e2e
pnpm e2e:web
```

The combined command assumes API and web are already running. It seeds deterministic state before the API flow and resets it again before the browser flow:

```bash
pnpm e2e
```

## CI beta gate

CI now:

1. installs dependencies and Chromium;
2. applies all migrations to fresh PostgreSQL 17;
3. seeds baseline and E2E identities;
4. runs static checks, typecheck, unit tests and production builds;
5. starts the built API and web app;
6. runs the API role flow;
7. reseeds deterministic E2E state;
8. runs the browser role flow;
9. uploads Playwright traces/screenshots/video and runtime logs on failure.

This keeps role authentication, MFA, RBAC, API wiring and the main portal shells in one repeatable beta acceptance path.
