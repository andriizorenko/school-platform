# ADR 0031 — Staging and release-candidate gate

## Status
Accepted for v31.

## Decision

A release is reproducible only when its dependency graph, source identity, schema state and background worker version are verifiable. v31 therefore adds four release gates:

1. a reviewed `pnpm-lock.yaml` with no `latest`/unbounded dependency specs;
2. immutable staging images built only with `pnpm install --frozen-lockfile`;
3. a database-backed worker heartbeat with release identity;
4. release preflight/manifest and staging smoke checks before promotion.

The API and worker expose the same `RELEASE_SHA` through health data. This makes partial rollouts visible instead of silently mixing application versions.

## Consequences

- CI/release builds are intentionally blocked until a real lockfile is generated in a networked trusted environment and committed.
- migrations remain a one-shot deployment action rather than an application-start side effect;
- staging uses production validation rules (`NODE_ENV=production`, `APP_ENV=staging`);
- Docker images are correctness-first release images; later image-size optimization must preserve the same frozen dependency graph and runtime behavior.
