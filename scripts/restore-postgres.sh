#!/usr/bin/env bash
set -euo pipefail

: "${BACKUP_FILE:?BACKUP_FILE is required}"
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required; DATABASE_URL is intentionally not accepted}"
[[ "${CONFIRM_RESTORE:-}" == "RESTORE" ]] || { echo "Set CONFIRM_RESTORE=RESTORE to acknowledge destructive restore." >&2; exit 1; }
if [[ "${NODE_ENV:-}" == "production" && "${ALLOW_PRODUCTION_RESTORE:-false}" != "true" ]]; then
  echo "Production restore blocked. Set ALLOW_PRODUCTION_RESTORE=true only during an approved recovery procedure." >&2
  exit 1
fi

POSTGRES_TOOL_IMAGE="${POSTGRES_TOOL_IMAGE:-postgres:17-alpine}"
POSTGRES_TOOL_MODE="${POSTGRES_TOOL_MODE:-auto}"
BACKUP_FILE_ABS="$(cd "$(dirname "$BACKUP_FILE")" && pwd)/$(basename "$BACKUP_FILE")"
BACKUP_DIR_ABS="$(dirname "$BACKUP_FILE_ABS")"
BASENAME="$(basename "$BACKUP_FILE_ABS")"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_FILE="$BACKUP_FILE_ABS" bash "$SCRIPT_DIR/verify-postgres-backup.sh"

if [[ "$POSTGRES_TOOL_MODE" != "docker" ]] && command -v pg_restore >/dev/null 2>&1; then
  pg_restore --clean --if-exists --no-owner --no-acl --exit-on-error --dbname="$RESTORE_DATABASE_URL" "$BACKUP_FILE_ABS"
elif command -v docker >/dev/null 2>&1; then
  docker run --rm --network host -v "${BACKUP_DIR_ABS}:/backup:ro" "$POSTGRES_TOOL_IMAGE" \
    pg_restore --clean --if-exists --no-owner --no-acl --exit-on-error --dbname="$RESTORE_DATABASE_URL" "/backup/${BASENAME}"
else
  echo "Neither pg_restore nor docker is available." >&2
  exit 1
fi

echo "Restore completed. Run migrations and application smoke tests before accepting traffic."
