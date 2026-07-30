#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_ENCRYPTION_PASSPHRASE:?BACKUP_ENCRYPTION_PASSPHRASE is required}"

backup_dir="${BACKUP_DIR:-backups}"
retention_days="${BACKUP_RETENTION_DAYS:-30}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir"

plain_path="$backup_dir/parici-$timestamp.dump"
encrypted_path="$plain_path.enc"

cleanup() {
  rm -f "$plain_path"
}
trap cleanup EXIT

pg_dump --dbname="$DATABASE_URL" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-privileges \
  --file="$plain_path"

pg_restore --list "$plain_path" >/dev/null
openssl enc -aes-256-cbc -salt -pbkdf2 \
  -pass env:BACKUP_ENCRYPTION_PASSPHRASE \
  -in "$plain_path" \
  -out "$encrypted_path"
shasum -a 256 "$encrypted_path" >"$encrypted_path.sha256"

find "$backup_dir" -type f -name 'parici-*.dump.enc*' -mtime "+$retention_days" -delete
printf '%s\n' "$encrypted_path"
