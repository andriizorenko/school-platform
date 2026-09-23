#!/usr/bin/env bash
set -euo pipefail

: "${BACKUP_FILE:?BACKUP_FILE is required}"
POSTGRES_TOOL_IMAGE="${POSTGRES_TOOL_IMAGE:-postgres:17-alpine}"
POSTGRES_TOOL_MODE="${POSTGRES_TOOL_MODE:-auto}"
BACKUP_FILE_ABS="$(cd "$(dirname "$BACKUP_FILE")" && pwd)/$(basename "$BACKUP_FILE")"
BACKUP_DIR_ABS="$(dirname "$BACKUP_FILE_ABS")"
BASENAME="$(basename "$BACKUP_FILE_ABS")"

[[ -s "$BACKUP_FILE_ABS" ]] || { echo "Backup file is missing or empty: $BACKUP_FILE_ABS" >&2; exit 1; }

if [[ -f "${BACKUP_FILE_ABS}.sha256" ]]; then
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$BACKUP_DIR_ABS" && sha256sum -c "${BASENAME}.sha256")
  elif command -v shasum >/dev/null 2>&1; then
    expected="$(awk '{print $1}' "${BACKUP_FILE_ABS}.sha256")"
    actual="$(shasum -a 256 "$BACKUP_FILE_ABS" | awk '{print $1}')"
    [[ "$expected" == "$actual" ]] || { echo "Backup checksum mismatch" >&2; exit 1; }
  fi
fi

if [[ "$POSTGRES_TOOL_MODE" != "docker" ]] && command -v pg_restore >/dev/null 2>&1; then
  pg_restore --list "$BACKUP_FILE_ABS" >/dev/null
elif command -v docker >/dev/null 2>&1; then
  docker run --rm -v "${BACKUP_DIR_ABS}:/backup:ro" "$POSTGRES_TOOL_IMAGE" pg_restore --list "/backup/${BASENAME}" >/dev/null
else
  echo "Neither pg_restore nor docker is available." >&2
  exit 1
fi

echo "Backup verification PASS: $BACKUP_FILE_ABS"
