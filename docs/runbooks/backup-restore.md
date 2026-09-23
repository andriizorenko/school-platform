# PostgreSQL backup / restore runbook

## Backup

Run from the repository root with the production `DATABASE_URL` injected by the secret manager:

```bash
BACKUP_DIR=/secure/backups BACKUP_RETENTION_DAYS=14 pnpm backup:db
```

The command creates a PostgreSQL custom-format `.dump` and, when supported by the host, a `.sha256` checksum file. Copy backups to storage with independent credentials/versioning; a backup that exists only on the application host is not sufficient disaster recovery.

Verify every produced backup:

```bash
BACKUP_FILE=/secure/backups/school-YYYYMMDDTHHMMSSZ.dump pnpm verify:backup
```

## Restore drill

Restore into a disposable database first. Never use the normal `DATABASE_URL` as the restore target; the script accepts only `RESTORE_DATABASE_URL`.

```bash
BACKUP_FILE=/secure/backups/school-....dump \
RESTORE_DATABASE_URL=postgresql://.../school_restore_drill \
CONFIRM_RESTORE=RESTORE \
pnpm restore:db
```

Then run migrations and the production smoke suite against the restored environment. Verify representative counts for users, families, enrollments, orders, payments, lesson credits and migration history before declaring the drill successful.

## Production recovery

Production restore is destructive and intentionally requires both:

```text
CONFIRM_RESTORE=RESTORE
ALLOW_PRODUCTION_RESTORE=true
```

Before using them: stop writes, record the incident/request id, preserve the broken database if possible, select and verify the recovery point, restore, run migrations, run smoke checks, compare financial/lesson-credit invariants, then reopen traffic. Record actual RPO/RTO after every drill.
