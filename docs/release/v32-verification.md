# v32 authoring-environment verification

Executed in the artifact-authoring environment:

- foundation check: PASS;
- integration check: PASS;
- 54 migration files are sequential;
- 217 API routes have no duplicate method/path pair in the repository checker;
- 52 referenced permissions are seeded;
- 13 referenced school settings are seeded;
- 13 emitted notification event types are registered with audiences;
- all TS/TSX files parse with the TypeScript parser;
- all JS/MJS files pass `node --check`;
- shell scripts pass `bash -n`;
- package JSON, workflow YAML and staging Compose YAML parse successfully;
- final beta gate fails closed without `pnpm-lock.yaml`;
- release evidence verifier accepts matching release/lock evidence and rejects a substituted lock hash.

Not executed here:

- `pnpm install --frozen-lockfile` / typecheck / dependency-aware unit tests / production builds;
- PostgreSQL migration/backup/restore execution;
- Playwright against running services;
- Docker/Caddy image build or live HTTPS certificate issuance.

Reason: this environment cannot resolve `registry.npmjs.org` (`EAI_AGAIN`) and does not provide local PostgreSQL/Docker/Caddy. The CI/RC workflows contain those gates, but they must actually run green in a networked build environment before promotion.
