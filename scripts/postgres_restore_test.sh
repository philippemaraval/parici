#!/usr/bin/env bash
set -euo pipefail

: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required}"

input_path="${1:?Usage: postgres_restore_test.sh <dump-or-encrypted-dump>}"
restore_path="$input_path"
temporary_dump=""

cleanup() {
  if [[ -n "$temporary_dump" ]]; then rm -f "$temporary_dump"; fi
}
trap cleanup EXIT

if [[ "$input_path" == *.enc ]]; then
  : "${BACKUP_ENCRYPTION_PASSPHRASE:?BACKUP_ENCRYPTION_PASSPHRASE is required for encrypted dumps}"
  temporary_dump="$(mktemp "${TMPDIR:-/tmp}/camino-restore.XXXXXX.dump")"
  openssl enc -d -aes-256-cbc -pbkdf2 \
    -pass env:BACKUP_ENCRYPTION_PASSPHRASE \
    -in "$input_path" \
    -out "$temporary_dump"
  restore_path="$temporary_dump"
fi

pg_restore --exit-on-error --clean --if-exists --no-owner --no-privileges \
  --schema=public \
  --dbname="$RESTORE_DATABASE_URL" "$restore_path"

psql "$RESTORE_DATABASE_URL" \
  --set=ON_ERROR_STOP=1 \
  --tuples-only \
  --command="SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" |
  awk '{ count += $1 } END { if (count < 1) exit 1; print "Restore test passed:", count, "public tables" }'
