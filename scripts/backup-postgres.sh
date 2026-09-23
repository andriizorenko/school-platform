#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
POSTGRES_TOOL_IMAGE="${POSTGRES_TOOL_IMAGE:-postgres:17-alpine}"
POSTGRES_TOOL_MODE="${POSTGRES_TOOL_MODE:-auto}"
mkdir -p "$BACKUP_DIR"
BACKUP_DIR_ABS="$(cd "$BACKUP_DIR" && pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BASENAME="school-${STAMP}.dump"
OUTPUT="${BACKUP_DIR_ABS}/${BASENAME}"

if [[ "$POSTGRES_TOOL_MODE" != "docker" ]] && command -v pg_dump >/dev/null 2>&1; then
  pg_dump "$DATABASE_URL" --format=custom --no-owner --no-acl --file="$OUTPUT"
elif command -v docker >/dev/null 2>&1; then
  docker run --rm --network host -v "${BACKUP_DIR_ABS}:/backup" "$POSTGRES_TOOL_IMAGE" \
    pg_dump "$DATABASE_URL" --format=custom --no-owner --no-acl --file="/backup/${BASENAME}"
else
  echo "Neither pg_dump nor docker is available." >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$BACKUP_DIR_ABS" && sha256sum "$BASENAME" > "${BASENAME}.sha256")
elif command -v shasum >/dev/null 2>&1; then
  (cd "$BACKUP_DIR_ABS" && shasum -a 256 "$BASENAME" > "${BASENAME}.sha256")
fi

if [[ -n "${BACKUP_RETENTION_DAYS:-}" ]]; then
  if [[ ! "$BACKUP_RETENTION_DAYS" =~ ^[0-9]+$ ]] || [[ "$BACKUP_RETENTION_DAYS" -lt 1 ]]; then
    echo "BACKUP_RETENTION_DAYS must be a positive integer." >&2
    exit 1
  fi
  find "$BACKUP_DIR_ABS" -type f \( -name 'school-*.dump' -o -name 'school-*.dump.sha256' \) -mtime "+${BACKUP_RETENTION_DAYS}" -delete
fi

printf '%s\n' "$OUTPUT"
