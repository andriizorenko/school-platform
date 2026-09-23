# v33 authoring-environment verification

Executed in the artifact-authoring environment:

- foundation check: PASS;
- integration check: PASS;
- 54 migration files are sequential;
- 217 API routes have no duplicate method/path pair in the repository checker;
- 52 referenced permissions are seeded;
- 13 referenced school settings are seeded;
- 13 emitted notification event types are registered with audiences;
- 333 TS/TSX files parse with the TypeScript parser: 0 syntax errors;
- JS/MJS scripts pass `node --check`;
- shell scripts pass `bash -n`;
- package JSON, workflow YAML and Compose YAML parse successfully;
- pure dependency-free unit layer: 26/26 PASS;
- staging env preflight: normal mode PASS with valid synthetic config;
- staging env preflight: acceptance mode PASS with dual explicit seed acknowledgement;
- staging env preflight: placeholder template correctly REJECTED;
- actual release preflight without `pnpm-lock.yaml`: correctly BLOCKED;
- release preflight in a temporary Git repository: untracked lockfile REJECTED, staged-but-uncommitted lockfile REJECTED, committed lockfile PASS;
- dependency-tree evidence synthetic harness: PASS;
- dependency-tree hash remains identical when only absolute runner paths change: PASS;
- dependency audit evidence synthetic harness: PASS;
- Docker image evidence synthetic `docker inspect` harness: PASS for three matching OCI revision labels;
- release evidence verifier: matching dependency/audit/acceptance/image bundle PASS;
- release evidence verifier: modified evidence file correctly REJECTED;
- release manifest v2 synthetic harness: PASS and includes `.env.example` + `.env.staging.example` in the source hash while excluding generated `artifacts/`.

Not executed here:

- generation/review of the real `pnpm-lock.yaml`;
- `pnpm install --frozen-lockfile` against the real registry-resolved dependency graph;
- the real network-backed dependency audit;
- dependency-aware workspace typecheck/tests/build;
- PostgreSQL migration/backup/restore execution;
- Playwright against running API/Web/Worker services;
- real Docker image builds / `docker image inspect` evidence;
- live Caddy HTTPS / ACME issuance;
- real final beta acceptance against a deployed staging environment.

Reason: the authoring environment cannot currently download pnpm from `registry.npmjs.org`, and Docker/PostgreSQL are not available locally. v33 adds the **Dependency Bootstrap** and strengthened **Release Candidate** workflows so those missing gates can be executed and evidenced on a networked runner rather than being inferred or hand-authored.
