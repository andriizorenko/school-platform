import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function fail(message) { failures.push(message); }
function walk(directory, predicate = () => true) {
  const output = [];
  if (!fs.existsSync(directory)) return output;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...walk(full, predicate));
    else if (predicate(full)) output.push(full);
  }
  return output;
}
function normalizeRoute(value) {
  return value.replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/");
}

// 1) Migration sequence and SQL dependency order.
const migrationDir = path.join(root, "packages/db/migrations");
const migrations = fs.readdirSync(migrationDir).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
const migrationNumbers = migrations.map((name) => Number(name.match(/^(\d+)/)?.[1]));
for (let index = 0; index < migrationNumbers.length; index += 1) {
  if (migrationNumbers[index] !== index + 1) fail(`Migration sequence gap: expected ${String(index + 1).padStart(4, "0")}, found ${migrations[index]}`);
}
const knownTables = new Set();
for (const filename of migrations) {
  const sql = fs.readFileSync(path.join(migrationDir, filename), "utf8");
  for (const statement of sql.split(";")) {
    const create = statement.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z_][\w]*)/i);
    if (create) knownTables.add(create[1].toLowerCase());
    const alter = statement.match(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-zA-Z_][\w]*)/i);
    if (alter && !knownTables.has(alter[1].toLowerCase())) fail(`${filename}: ALTER TABLE references table before creation: ${alter[1]}`);
    for (const match of statement.matchAll(/REFERENCES\s+([a-zA-Z_][\w]*)/gi)) {
      if (!knownTables.has(match[1].toLowerCase())) fail(`${filename}: foreign key references table before creation: ${match[1]}`);
    }
  }
}

const sourceFiles = [
  ...walk(path.join(root, "apps"), (file) => /\.(ts|tsx)$/.test(file)),
  ...walk(path.join(root, "packages"), (file) => /\.(ts|tsx)$/.test(file)),
];

// 2) Relative import resolution. Handles TS source imports that intentionally use .js for NodeNext output.
for (const file of sourceFiles) {
  const text = fs.readFileSync(file, "utf8");
  for (const match of text.matchAll(/(?:from\s+|import\s*\()(["'])([^"']+)\1/g)) {
    const specifier = match[2];
    if (!specifier.startsWith(".")) continue;
    const base = path.resolve(path.dirname(file), specifier);
    const extension = path.extname(base).toLowerCase();
    const candidates = [];
    if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"].includes(extension)) {
      candidates.push(base);
      if (extension === ".js") candidates.push(base.slice(0, -3) + ".ts", base.slice(0, -3) + ".tsx");
    } else {
      candidates.push(`${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, path.join(base, "index.ts"), path.join(base, "index.tsx"), path.join(base, "index.js"));
    }
    if (!candidates.some((candidate) => fs.existsSync(candidate))) fail(`${path.relative(root, file)}: unresolved relative import ${specifier}`);
  }
}

let registryText = migrations.map((name) => fs.readFileSync(path.join(migrationDir, name), "utf8")).join("\n");
registryText += `\n${fs.readFileSync(path.join(root, "packages/db/src/seed.ts"), "utf8")}`;

// 3) Permission references must be seeded.
const permissionRefs = new Set();
for (const file of sourceFiles.filter((file) => file.includes(`${path.sep}apps${path.sep}api${path.sep}`))) {
  const text = fs.readFileSync(file, "utf8");
  for (const call of text.matchAll(/RequirePermissions\(([^)]*)\)/g)) {
    for (const literal of call[1].matchAll(/["']([^"']+)["']/g)) permissionRefs.add(literal[1]);
  }
  for (const match of text.matchAll(/permissions\.includes\(\s*["']([^"']+)["']\s*\)/g)) permissionRefs.add(match[1]);
}
for (const permission of permissionRefs) {
  if (!registryText.includes(`'${permission}'`) && !registryText.includes(`"${permission}"`)) fail(`Permission is referenced but never seeded: ${permission}`);
}

// 4) School setting keys used by business logic must exist in migrations.
const settingRefs = new Set();
for (const file of sourceFiles.filter((file) => file.includes(`${path.sep}apps${path.sep}`))) {
  const text = fs.readFileSync(file, "utf8");
  for (const match of text.matchAll(/(?:numberSchoolSetting|stringSchoolSetting)\([^,]+,\s*["']([^"']+)["']/g)) settingRefs.add(match[1]);
  for (const match of text.matchAll(/settingNumber\(\s*["']([^"']+)["']/g)) settingRefs.add(match[1]);
  for (const match of text.matchAll(/school_settings\s+WHERE\s+key\s*=\s*'([^']+)'/gi)) settingRefs.add(match[1]);
}
for (const key of settingRefs) if (!registryText.includes(`'${key}'`)) fail(`School setting is referenced but never seeded: ${key}`);

// 5) Notification events emitted by application/worker must be registered and have an audience.
const notificationRefs = new Set();
for (const file of sourceFiles.filter((file) => file.includes(`${path.sep}apps${path.sep}api${path.sep}`))) {
  const text = fs.readFileSync(file, "utf8");
  for (const call of text.matchAll(/publishNotification\(\s*\{([\s\S]*?)\}\s*(?:,|\))/g)) {
    const event = call[1].match(/eventType\s*:\s*["']([A-Z0-9_]+)["']/);
    if (event) notificationRefs.add(event[1]);
  }
}
const plannerPath = path.join(root, "apps/worker/src/notification-planner.ts");
if (fs.existsSync(plannerPath)) {
  const text = fs.readFileSync(plannerPath, "utf8");
  for (const match of text.matchAll(/eventType:\s*["']([A-Z0-9_]+)["']/g)) notificationRefs.add(match[1]);
}
for (const eventType of notificationRefs) {
  if (!registryText.includes(`('${eventType}'`)) fail(`Notification event is emitted but not registered: ${eventType}`);
  const audiencePattern = new RegExp(`\\('${eventType}'\\s*,\\s*'(?:ADMIN|SUPPORT_MANAGER|MANAGER|FINANCIER|TEACHER|PARENT|STUDENT)'`);
  if (!audiencePattern.test(registryText)) fail(`Notification event has no role audience: ${eventType}`);
}

// 6) Nest controller routes must be unique.
const controllerFiles = sourceFiles.filter((file) => file.includes(`${path.sep}apps${path.sep}api${path.sep}`) && file.endsWith(".controller.ts"));
const routes = [];
for (const file of controllerFiles) {
  const text = fs.readFileSync(file, "utf8");
  const prefix = text.match(/@Controller\(\s*["']([^"']*)["']\s*\)/)?.[1] ?? "";
  for (const match of text.matchAll(/@(Get|Post|Put|Patch|Delete)\(\s*(?:["']([^"']*)["'])?\s*\)/g)) {
    routes.push({ method: match[1].toUpperCase(), path: normalizeRoute([prefix, match[2] ?? ""].filter(Boolean).join("/")), file: path.relative(root, file) });
  }
}
const routeMap = new Map();
for (const route of routes) {
  const key = `${route.method} ${route.path}`;
  const existing = routeMap.get(key) ?? [];
  existing.push(route.file);
  routeMap.set(key, existing);
}
for (const [route, files] of routeMap) if (files.length > 1) fail(`Duplicate API route ${route}: ${files.join(", ")}`);

// 7) Every environment key referenced directly by runtime code should be documented in .env.example.
const envExample = fs.readFileSync(path.join(root, ".env.example"), "utf8");
const documentedEnv = new Set([...envExample.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]));
const envRefs = new Set();
for (const file of sourceFiles) {
  const text = fs.readFileSync(file, "utf8");
  for (const match of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) envRefs.add(match[1]);
  for (const match of text.matchAll(/(?:config|this\.config)\.get(?:<[^>]+>)?\(\s*["']([A-Z][A-Z0-9_]*)["']/g)) envRefs.add(match[1]);
}
for (const key of envRefs) if (!documentedEnv.has(key)) fail(`Environment variable is used but missing from .env.example: ${key}`);

// 8) Production safety/build-order invariants.
const appModule = fs.readFileSync(path.join(root, "apps/api/src/app.module.ts"), "utf8");
if (!appModule.includes("validate: validateEnvironment")) fail("API ConfigModule must use validateEnvironment");
const turbo = JSON.parse(fs.readFileSync(path.join(root, "turbo.json"), "utf8"));
if (!(turbo.tasks?.dev?.dependsOn ?? []).includes("^build")) fail("turbo dev must build workspace dependencies before starting apps");
if (!(turbo.tasks?.typecheck?.dependsOn ?? []).includes("^build")) fail("turbo typecheck must build workspace dependencies first");
const apiPackage = JSON.parse(fs.readFileSync(path.join(root, "apps/api/package.json"), "utf8"));
if (!String(apiPackage.scripts?.test ?? "").startsWith("tsx --test")) fail("API TypeScript tests must run through tsx/node:test");

// 9) Beta E2E wiring must remain executable and deterministic.
const rootPackage = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const dbPackage = JSON.parse(fs.readFileSync(path.join(root, "packages/db/package.json"), "utf8"));
for (const script of ["db:seed:e2e", "e2e:api", "e2e:web", "e2e"]) {
  if (!rootPackage.scripts?.[script]) fail(`Root package is missing E2E script: ${script}`);
}
if (!dbPackage.scripts?.["seed:e2e"]) fail("@school/db is missing seed:e2e script");
for (const requiredPath of [
  "packages/db/src/seed-e2e.ts",
  "tests/e2e/api-flow.mjs",
  "tests/e2e/web/role-smoke.spec.ts",
  "tests/e2e/liqpay-mock.mjs",
  "tests/e2e/mono-mock.mjs",
  "playwright.config.ts",
  "packages/db/migrations/0050_liqpay_payment_provider.sql",
  "packages/db/migrations/0051_multi_provider_mono.sql",
  "apps/api/src/modules/billing/providers/payment-provider.ts",
  "apps/api/src/modules/billing/providers/payment-providers.service.ts",
  "apps/api/src/modules/billing/providers/liqpay.service.ts",
  "apps/api/src/modules/billing/providers/liqpay-signature.ts",
  "apps/api/src/modules/billing/providers/mono.service.ts",
  "apps/api/src/modules/billing/providers/mono-signature.ts",
]) {
  if (!fs.existsSync(path.join(root, requiredPath))) fail(`Missing E2E asset: ${requiredPath}`);
}
const ciText = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
for (const command of [
  "pnpm db:seed:e2e",
  "pnpm e2e:api",
  "pnpm e2e:web",
  "playwright install --with-deps chromium",
  "tests/e2e/liqpay-mock.mjs",
  "tests/e2e/mono-mock.mjs",
  "PAYMENT_DEFAULT_PROVIDER: MONO",
  'LIQPAY_ENABLED: "true"',
  'MONO_ENABLED: "true"',
]) {
  if (!ciText.includes(command)) fail(`CI is missing beta E2E step: ${command}`);
}

// 10) LiqPay payment/refund hardening invariants.
const liqpaySignatureSource = fs.readFileSync(path.join(root, "apps/api/src/modules/billing/providers/liqpay-signature.ts"), "utf8");
if (!liqpaySignatureSource.includes('createHash("sha3-256")')) fail("LiqPay signatures must use SHA3-256");
const liqpayMigration = fs.readFileSync(path.join(root, "packages/db/migrations/0050_liqpay_payment_provider.sql"), "utf8");
for (const invariant of ["PURCHASE_REFUND", "payment_provider_events", "payment_refunds", "billing.refund"]) {
  if (!liqpayMigration.includes(invariant)) fail(`LiqPay migration is missing invariant: ${invariant}`);
}
if (!liqpayMigration.includes("UNIQUE INDEX") || !liqpayMigration.includes("event_hash")) fail("LiqPay provider events must have a uniqueness/idempotency constraint");
const billingService = fs.readFileSync(path.join(root, "apps/api/src/modules/billing/billing.service.ts"), "utf8");
if (!billingService.includes("PARTIALLY_REFUNDED")) fail("Billing service must preserve partial-refund state");
if (!billingService.includes("PURCHASE_REFUND")) fail("Billing service must debit refunded purchase credits");

// 11) Multi-provider / Monobank payment invariants.
const monoSignatureSource = fs.readFileSync(path.join(root, "apps/api/src/modules/billing/providers/mono-signature.ts"), "utf8");
if (!monoSignatureSource.includes('createVerify("SHA256")')) fail("Monobank webhook signatures must use ECDSA/SHA-256");
const monoServiceSource = fs.readFileSync(path.join(root, "apps/api/src/modules/billing/providers/mono.service.ts"), "utf8");
for (const endpoint of ["/api/merchant/invoice/create", "/api/merchant/invoice/remove", "/api/merchant/invoice/cancel", "/api/merchant/pubkey"]) {
  if (!monoServiceSource.includes(endpoint)) fail(`Monobank provider is missing endpoint: ${endpoint}`);
}
const monoMigration = fs.readFileSync(path.join(root, "packages/db/migrations/0051_multi_provider_mono.sql"), "utf8");
for (const invariant of ["payment_provider", "provider_updated_at", "provider_checkout_url", "MONO", "LIQPAY"]) {
  if (!monoMigration.includes(invariant)) fail(`Multi-provider migration is missing invariant: ${invariant}`);
}
if (!monoMigration.includes("CREATE UNIQUE INDEX") || !monoMigration.includes("provider_payment_id")) fail("Provider payment ids must be unique per provider");
const apiMain = fs.readFileSync(path.join(root, "apps/api/src/main.ts"), "utf8");
if (!apiMain.includes("rawBody: true")) fail("API must retain raw request bodies for Monobank ECDSA webhook verification");
if (!billingService.includes("STALE_PROVIDER_EVENT")) fail("Billing service must reject stale/out-of-order Monobank events");
if (!billingService.includes("PAYMENT_REFERENCE_MISMATCH")) fail("Monobank callbacks must detect mismatched merchant references");
if (!billingService.includes("EXTERNAL_REFUND_REQUIRES_RECONCILIATION")) fail("External provider refunds must be surfaced for reconciliation");
if (!billingService.includes("PAYMENT_FOR_CANCELLED_ORDER_REQUIRES_RECONCILIATION")) fail("Payment callbacks must not grant credits to cancelled orders");
if (!billingService.includes('providerStatus: "transport_unknown"')) fail("Refund transport uncertainty must remain pending for reconciliation");


// 12) Production security / observability / recovery invariants.
for (const requiredPath of [
  "packages/db/migrations/0052_security_rate_limits.sql",
  "apps/api/src/common/security/security.service.ts",
  "apps/api/src/common/security/security-headers.ts",
  "apps/api/src/common/observability/json-logger.service.ts",
  "apps/api/src/common/observability/metrics.service.ts",
  "apps/api/src/common/observability/metrics.controller.ts",
  "scripts/production-smoke.mjs",
  "scripts/backup-postgres.sh",
  "scripts/verify-postgres-backup.sh",
  "scripts/restore-postgres.sh",
  "docs/runbooks/deployment.md",
  "docs/runbooks/backup-restore.md",
]) {
  if (!fs.existsSync(path.join(root, requiredPath))) fail(`Missing production-hardening asset: ${requiredPath}`);
}
const securityMigration = fs.readFileSync(path.join(root, "packages/db/migrations/0052_security_rate_limits.sql"), "utf8");
if (!securityMigration.includes("api_rate_limit_buckets")) fail("Distributed rate-limit table is missing");
const securitySource = fs.readFileSync(path.join(root, "apps/api/src/common/security/security.service.ts"), "utf8");
for (const invariant of ["RATE_LIMIT_LOGIN_IP_MAX", "RATE_LIMIT_LOGIN_IDENTITY_MAX", "webhook_liqpay_ip", "webhook_mono_ip", "webhook_telegram_ip", "createHmac"]) {
  if (!securitySource.includes(invariant)) fail(`Security limiter is missing invariant: ${invariant}`);
}
for (const invariant of ["trust proxy", "STRICT_ORIGIN_CHECK_ENABLED", "enforceRateLimits", "useLogger", "x-powered-by"]) {
  if (!apiMain.includes(invariant)) fail(`API bootstrap is missing production invariant: ${invariant}`);
}
const nextConfig = fs.readFileSync(path.join(root, "apps/web/next.config.ts"), "utf8");
for (const header of ["Content-Security-Policy", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Strict-Transport-Security"]) {
  if (!nextConfig.includes(header)) fail(`Web security headers are missing: ${header}`);
}
for (const script of ["smoke:production", "backup:db", "restore:db", "verify:backup"]) {
  if (!rootPackage.scripts?.[script]) fail(`Root package is missing production script: ${script}`);
}
for (const [packageFile, packageJson] of [
  ["package.json", rootPackage],
  ["apps/web/package.json", JSON.parse(fs.readFileSync(path.join(root, "apps/web/package.json"), "utf8"))],
]) {
  for (const section of ["dependencies", "devDependencies"]) {
    for (const [name, version] of Object.entries(packageJson[section] ?? {})) {
      if (version === "latest") fail(`${packageFile}: ${section}.${name} must not use latest in a production build`);
    }
  }
}
const webPackage = JSON.parse(fs.readFileSync(path.join(root, "apps/web/package.json"), "utf8"));
if (webPackage.dependencies?.next !== "15.5.26") fail("Next.js must remain pinned to the current v15 Maintenance LTS security hardening release (15.5.26)");
for (const command of ["pnpm smoke:production", "Backup / restore drill"]) {
  if (!ciText.includes(command)) fail(`CI is missing production gate: ${command}`);
}

// 13) Staging / release-candidate invariants.
for (const requiredPath of [
  "packages/db/migrations/0053_service_heartbeats.sql",
  "scripts/release-preflight.mjs",
  "scripts/create-release-manifest.mjs",
  "scripts/staging-smoke.mjs",
  "scripts/bootstrap-lockfile.sh",
  "docker/Dockerfile.api",
  "docker/Dockerfile.worker",
  "docker/Dockerfile.web",
  "docker-compose.staging.yml",
  ".env.staging.example",
  ".github/workflows/release-candidate.yml",
  "docs/runbooks/staging-release-candidate.md",
  "docs/architecture/0031-staging-release-candidate.md",
]) {
  if (!fs.existsSync(path.join(root, requiredPath))) fail(`Missing release-candidate asset: ${requiredPath}`);
}
const heartbeatMigration = fs.readFileSync(path.join(root, "packages/db/migrations/0053_service_heartbeats.sql"), "utf8");
if (!heartbeatMigration.includes("service_heartbeats")) fail("Worker heartbeat table is missing");
const workerMain = fs.readFileSync(path.join(root, "apps/worker/src/main.ts"), "utf8");
for (const invariant of ["recordHeartbeat", "RELEASE_SHA", 'service_name,last_seen_at']) {
  if (!workerMain.includes(invariant)) fail(`Worker release heartbeat is missing invariant: ${invariant}`);
}
const healthController = fs.readFileSync(path.join(root, "apps/api/src/common/health/health.controller.ts"), "utf8");
for (const invariant of ['@Get("worker")', "WORKER_HEARTBEAT_MAX_AGE_SECONDS", "releaseSha"]) {
  if (!healthController.includes(invariant)) fail(`Health controller is missing staging invariant: ${invariant}`);
}
for (const script of ["release:preflight", "release:manifest", "smoke:staging", "lockfile:bootstrap"]) {
  if (!rootPackage.scripts?.[script]) fail(`Root package is missing release script: ${script}`);
}
for (const [packageFile, packageJson] of [
  ["package.json", rootPackage],
  ...[...walk(path.join(root, "apps"), (file) => file.endsWith("package.json")), ...walk(path.join(root, "packages"), (file) => file.endsWith("package.json"))]
    .map((file) => [path.relative(root, file), JSON.parse(fs.readFileSync(file, "utf8"))]),
]) {
  for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const [name, version] of Object.entries(packageJson[section] ?? {})) {
      const value = String(version).trim();
      if (["latest", "*"].includes(value) || /^(?:https?:|git\+)/.test(value)) fail(`${packageFile}: ${section}.${name} uses a non-release-safe dependency spec (${value})`);
    }
  }
}
if (!ciText.includes("pnpm install --frozen-lockfile")) fail("CI must use frozen lockfile installs for v31");
const releaseManifestSource = fs.readFileSync(path.join(root, "scripts/create-release-manifest.mjs"), "utf8");
if (!releaseManifestSource.includes("pnpm-lock.yaml is required")) fail("Release manifest must fail closed without pnpm-lock.yaml");
if (!ciText.includes("pnpm smoke:staging") && !ciText.includes("pnpm acceptance:beta")) fail("CI must execute staging smoke directly or through final beta acceptance");
if (!ciText.includes("actions/checkout@v7.0.1")) fail("CI checkout action must stay on reviewed v7.0.1");
if (!ciText.includes("actions/setup-node@v7.0.0")) fail("CI setup-node action must stay on reviewed v7.0.0");
if (!ciText.includes("actions/upload-artifact@v7.0.1")) fail("CI upload-artifact action must stay on reviewed v7.0.1");
const releaseWorkflow = fs.readFileSync(path.join(root, ".github/workflows/release-candidate.yml"), "utf8");
for (const command of ["release-preflight.mjs", "pnpm install --frozen-lockfile", "pnpm acceptance:beta", "pnpm release:manifest", "docker/Dockerfile.api", "docker/Dockerfile.worker", "docker/Dockerfile.web"]) {
  if (!releaseWorkflow.includes(command)) fail(`Release Candidate workflow is missing gate: ${command}`);
}


// 14) Final beta acceptance / payment reconciliation invariants.
for (const requiredPath of [
  "packages/db/migrations/0054_payment_reconciliation.sql",
  "scripts/final-beta-check.mjs",
  "scripts/final-beta-acceptance.mjs",
  "scripts/verify-release-evidence.mjs",
  "deploy/Caddyfile.staging",
  "docs/runbooks/final-beta-acceptance.md",
  "docs/architecture/0032-final-beta-acceptance.md",
]) {
  if (!fs.existsSync(path.join(root, requiredPath))) fail(`Missing final-beta asset: ${requiredPath}`);
}
const reconciliationMigration = fs.readFileSync(path.join(root, "packages/db/migrations/0054_payment_reconciliation.sql"), "utf8");
for (const invariant of ["reconciled_at", "reconciled_by", "reconciliation_note", "billing.reconcile"]) {
  if (!reconciliationMigration.includes(invariant)) fail(`Payment reconciliation migration is missing invariant: ${invariant}`);
}
const opsController = fs.readFileSync(path.join(root, "apps/api/src/modules/ops/ops.controller.ts"), "utf8");
for (const invariant of ["ops/payment-reconciliation", "billing.reconcile", "resolvePaymentReconciliation"]) {
  if (!opsController.includes(invariant)) fail(`Operations reconciliation API is missing invariant: ${invariant}`);
}
const opsService = fs.readFileSync(path.join(root, "apps/api/src/modules/ops/ops.service.ts"), "utf8");
for (const invariant of ["reconciled_at", "STALE_PROVIDER_EVENT", "RESOLVE_PAYMENT_RECONCILIATION"]) {
  if (!opsService.includes(invariant)) fail(`Operations reconciliation service is missing invariant: ${invariant}`);
}
const seedE2E = fs.readFileSync(path.join(root, "packages/db/src/seed-e2e.ts"), "utf8");
for (const invariant of ["E2E_ALLOW_STAGING_SEED", "APP_ENV=production", 'includes(appEnv)']) {
  if (!seedE2E.includes(invariant)) fail(`Staging seed safety gate is missing invariant: ${invariant}`);
}
for (const script of ["acceptance:check", "acceptance:beta", "release:evidence"]) {
  if (!rootPackage.scripts?.[script]) fail(`Root package is missing final-beta script: ${script}`);
}
const betaAcceptance = fs.readFileSync(path.join(root, "scripts/final-beta-acceptance.mjs"), "utf8");
for (const invariant of ["ACCEPTANCE_BACKUP_FILE", "pnpm-lock.yaml", "e2e:api", "e2e:web", "final-beta-check.mjs", "beta-acceptance-report.json"]) {
  if (!betaAcceptance.includes(invariant)) fail(`Final beta acceptance runner is missing invariant: ${invariant}`);
}
const finalBetaCheck = fs.readFileSync(path.join(root, "scripts/final-beta-check.mjs"), "utf8");
for (const invariant of ["payment-reconciliation", "Unresolved payment reconciliation events remain", "releaseSha", "ACCEPTANCE_REQUIRE_HTTPS"]) {
  if (!finalBetaCheck.includes(invariant)) fail(`Final beta go/no-go check is missing invariant: ${invariant}`);
}
const stagingCompose = fs.readFileSync(path.join(root, "docker-compose.staging.yml"), "utf8");
for (const invariant of ["caddy:2.11.4-alpine", "deploy/Caddyfile.staging", '"80:80"', '"443:443"']) {
  if (!stagingCompose.includes(invariant)) fail(`Staging TLS topology is missing invariant: ${invariant}`);
}
if (!releaseWorkflow.includes("pnpm acceptance:beta")) fail("Release Candidate workflow must execute final beta acceptance");
if (!releaseWorkflow.includes("ACCEPTANCE_BACKUP_FILE")) fail("Release Candidate workflow must bind acceptance to a verified backup artifact");
if (!releaseWorkflow.includes("pnpm release:evidence")) fail("Release Candidate workflow must verify manifest/acceptance evidence binding");

// 15) v33 networked dependency/image provenance invariants.
for (const requiredPath of [
  ".github/workflows/dependency-bootstrap.yml",
  "scripts/staging-env-preflight.mjs",
  "scripts/create-dependency-evidence.mjs",
  "scripts/audit-dependencies.mjs",
  "scripts/create-image-evidence.mjs",
  "docs/runbooks/networked-release-bootstrap.md",
  "docs/architecture/0033-release-candidate-provenance.md",
]) {
  if (!fs.existsSync(path.join(root, requiredPath))) fail(`Missing v33 release provenance asset: ${requiredPath}`);
}
for (const script of ["staging:preflight", "release:deps:evidence", "release:deps:audit", "release:images:evidence"]) {
  if (!rootPackage.scripts?.[script]) fail(`Root package is missing v33 release script: ${script}`);
}
const dependencyBootstrap = fs.readFileSync(path.join(root, ".github/workflows/dependency-bootstrap.yml"), "utf8");
for (const invariant of ["pnpm install --lockfile-only", "pnpm install --frozen-lockfile", "pnpm release:deps:audit", "pnpm release:deps:evidence", "pnpm-lock.patch"]) {
  if (!dependencyBootstrap.includes(invariant)) fail(`Dependency bootstrap workflow is missing invariant: ${invariant}`);
}
const stagingPreflight = fs.readFileSync(path.join(root, "scripts/staging-env-preflight.mjs"), "utf8");
for (const invariant of ["ACCEPTANCE_REQUIRE_HTTPS", "E2E_ALLOW_STAGING_SEED", "POSTGRES_DB", "NEXT_PUBLIC_API_URL", "STAGING_ACCEPTANCE_MODE"]) {
  if (!stagingPreflight.includes(invariant)) fail(`Staging env preflight is missing invariant: ${invariant}`);
}
const dependencyEvidence = fs.readFileSync(path.join(root, "scripts/create-dependency-evidence.mjs"), "utf8");
for (const invariant of ["pnpm-lock.yaml", "packageTreeSha256", "lockfileSha256", "RELEASE_SHA"]) {
  if (!dependencyEvidence.includes(invariant)) fail(`Dependency evidence is missing invariant: ${invariant}`);
}
const dependencyAudit = fs.readFileSync(path.join(root, "scripts/audit-dependencies.mjs"), "utf8");
for (const invariant of ["--audit-level", "high", "dependency-audit.json", "lockfileSha256"]) {
  if (!dependencyAudit.includes(invariant)) fail(`Dependency audit is missing invariant: ${invariant}`);
}
const imageEvidence = fs.readFileSync(path.join(root, "scripts/create-image-evidence.mjs"), "utf8");
for (const invariant of ["org.opencontainers.image.revision", "imageSetSha256", "school-api", "school-worker", "school-web"]) {
  if (!imageEvidence.includes(invariant)) fail(`Docker image evidence is missing invariant: ${invariant}`);
}
for (const dockerfile of ["docker/Dockerfile.api", "docker/Dockerfile.worker", "docker/Dockerfile.web"]) {
  const source = fs.readFileSync(path.join(root, dockerfile), "utf8");
  if (!source.includes("org.opencontainers.image.revision") || !source.includes("ARG RELEASE_SHA")) fail(`${dockerfile} must bind the image to RELEASE_SHA`);
}
for (const invariant of ["pnpm release:deps:audit", "pnpm release:deps:evidence", "pnpm release:images:evidence", "--build-arg RELEASE_SHA="]) {
  if (!releaseWorkflow.includes(invariant)) fail(`Release Candidate workflow is missing v33 provenance gate: ${invariant}`);
}
if (!releaseWorkflow.includes("if-no-files-found: error")) fail("Release Candidate evidence upload must fail closed when evidence is missing");
const releaseEvidence = fs.readFileSync(path.join(root, "scripts/verify-release-evidence.mjs"), "utf8");
for (const invariant of ["dependency-evidence.json", "dependency-audit.json", "image-evidence.json", "Lockfile SHA mismatch", "Image revision mismatch"]) {
  if (!releaseEvidence.includes(invariant)) fail(`Release evidence verifier is missing v33 invariant: ${invariant}`);
}
const releasePreflightSource = fs.readFileSync(path.join(root, "scripts/release-preflight.mjs"), "utf8");
if (!releasePreflightSource.includes("git") || !releasePreflightSource.includes("pnpm-lock.yaml exists but is not committed/tracked by git") || !releasePreflightSource.includes("pnpm-lock.yaml must match committed HEAD before a release run")) fail("Release preflight must reject untracked or uncommitted lockfiles on real release runs");
if (!releaseManifestSource.includes("Required release evidence is missing") || !releaseManifestSource.includes("formatVersion: 2")) fail("Release manifest must bind v33 evidence files and use formatVersion 2");
if (!releaseManifestSource.includes('.env.staging.example')) fail("Release manifest must include the staging env template in the source hash");

if (failures.length) {
  console.error(`Integration check failed (${failures.length}):`);
  for (const item of failures) console.error(`- ${item}`);
  process.exit(1);
}
console.log(`Integration check passed (${migrations.length} migrations, ${routes.length} API routes, ${permissionRefs.size} permissions, ${settingRefs.size} settings, ${notificationRefs.size} notification events).`);

