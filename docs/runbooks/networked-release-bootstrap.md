# Networked Release Bootstrap (v33)

This runbook closes the gap between the offline source bundle and the first reproducible Release Candidate.

## 1. Generate the real lockfile on a trusted networked runner

Preferred: run the GitHub Actions workflow **Dependency Bootstrap** manually.

It performs:

1. Node 22 + pnpm 10.17.1 activation.
2. `pnpm install --lockfile-only --no-frozen-lockfile`.
3. `pnpm install --frozen-lockfile`.
4. release preflight + static repository checks.
5. dependency security audit at `high` severity threshold.
6. dependency-tree evidence generation.
7. an assertion that package manifests were not silently changed.

Download the `pnpm-lockfile-<sha>` artifact, review `pnpm-lock.yaml` and `artifacts/pnpm-lock.patch`, then commit only the reviewed lockfile.

Local equivalent on a trusted machine:

```bash
pnpm lockfile:bootstrap
RELEASE_SHA=$(git rev-parse HEAD) pnpm release:deps:audit
RELEASE_SHA=$(git rev-parse HEAD) pnpm release:deps:evidence
```

Do not hand-author or copy a lockfile from another branch.

## 2. Run Release Candidate workflow

After the lockfile is committed, run **Release Candidate**. It must complete:

```text
frozen install
dependency security audit
dependency-tree evidence
repository verify
migrations + deterministic E2E seed
backup / checksum / restore rehearsal
API + web + worker + provider mocks
final beta acceptance
Docker image builds with RELEASE_SHA OCI labels
Docker image evidence
release manifest
release evidence verification
```

A release candidate is not green until `pnpm release:evidence` passes.

## 3. Prepare live staging configuration

Copy the template without committing secrets:

```bash
cp .env.staging.example .env.staging
```

Fill real staging hostnames and secrets, then run:

```bash
pnpm staging:preflight
```

Normal staging must keep both E2E seed flags disabled.

For a dedicated disposable acceptance database only:

```bash
STAGING_ACCEPTANCE_MODE=true pnpm staging:preflight -- --acceptance
```

and explicitly enable both staging seed flags in that temporary environment.

## 4. Build/deploy the exact candidate

`docker-compose.staging.yml` passes `RELEASE_SHA` into API, worker and web images. Each image is labeled with:

```text
org.opencontainers.image.revision=<RELEASE_SHA>
```

Never deploy images built from a different SHA than the release evidence bundle.

## 5. Go / no-go

Production promotion requires all of the following:

- committed and reviewed `pnpm-lock.yaml`;
- frozen install PASS;
- dependency audit PASS (no high/critical production advisory according to the audit service at run time);
- complete dependency evidence;
- full v32 beta acceptance PASS;
- backup restore rehearsal PASS;
- three Docker image evidence records with matching revision;
- release manifest PASS;
- release evidence binding PASS;
- live staging HTTPS acceptance PASS.

Any missing or mismatched evidence is a NO-GO.
