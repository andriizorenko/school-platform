# ADR 0032 — Final beta acceptance and payment reconciliation

## Status
Accepted for v32.

## Context

v31 could prove that API, web and worker were built from one release and could run the primary role E2E flow. Two release risks remained:

1. payment-provider events that intentionally require human reconciliation had no explicit lifecycle for acknowledgement/resolution;
2. the final staging decision was spread across individual commands rather than one evidence-producing go/no-go gate.

The staging compose file also exposed only application ports and did not model the public TLS termination that production security settings assume.

## Decision

v32 adds an explicit payment reconciliation queue backed by `payment_provider_events`. Any provider event with a non-benign processing error is visible to staff with `billing.reconcile`; resolution records the actor, time and operator note and is written to the audit log. A resolved event leaves the unresolved queue but its immutable provider payload/error remains retained for investigation.

The final beta gate is `pnpm acceptance:beta`. It fails closed unless a reviewed lockfile, immutable `RELEASE_SHA`, explicit staging/RC environment, E2E reset acknowledgement and verified backup artifact are present. It executes release preflight, backup verification, staging smoke, deterministic role seed, API payment/RBAC E2E, browser role E2E and a final check that API/worker release identities match and no unresolved payment reconciliation remains. The runner writes machine-readable evidence and per-step logs under `artifacts/`.

Staging may run in `NODE_ENV=production`, but deterministic E2E seed is allowed only for `APP_ENV=staging|rc` with both `E2E_ALLOW_SEED=true` and `E2E_ALLOW_STAGING_SEED=true`. `APP_ENV=production` remains unconditionally blocked.

A pinned Caddy TLS terminator is included for staging. Public `WEB_HOST` and `API_HOST` are routed to the internal web/API services; Caddy automatic HTTPS is the reference staging topology. API `TRUST_PROXY_HOPS=1` assumes this single trusted reverse proxy.

## Consequences

- payment anomalies cannot be silently hidden by a successful HTTP callback;
- an RC cannot be promoted while its acceptance queue still contains unresolved payment events;
- final beta evidence can be retained with the release manifest and CI artifacts;
- production seeding remains forbidden even though production-mode staging acceptance is supported;
- staging DNS/ports 80+443 and ACME reachability become explicit deployment prerequisites.
