#!/bin/sh
# Daily pg_dump -Fc of the wds AND keycloak databases → S3 (Garage), with
# retention. Same dump format as `make backup`, so `make restore` reads it.
# S3 credentials come from mounted secret files (never env → docker inspect).
set -eu

: "${S3_ENDPOINT:?}" "${S3_BUCKET:?}" "${S3_ACCESS_KEY_FILE:?}" "${S3_SECRET_KEY_FILE:?}"
INTERVAL_S="${BACKUP_INTERVAL_S:-86400}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"

export PGHOST=postgres PGUSER=postgres PGPASSWORD="$(cat /run/secrets/pg_super_pw)"
export RCLONE_CONFIG_S3_TYPE=s3 RCLONE_CONFIG_S3_PROVIDER=Other
export RCLONE_CONFIG_S3_ENDPOINT="$S3_ENDPOINT" RCLONE_CONFIG_S3_REGION="${S3_REGION:-garage}"
export RCLONE_CONFIG_S3_ACCESS_KEY_ID="$(cat "$S3_ACCESS_KEY_FILE")"
export RCLONE_CONFIG_S3_SECRET_ACCESS_KEY="$(cat "$S3_SECRET_KEY_FILE")"
export RCLONE_CONFIG_S3_FORCE_PATH_STYLE=true

run_once() {
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  failed=0
  for db in wds keycloak; do
    f="/tmp/$db-$ts.dump"
    # a dump only counts once it is non-empty AND uploaded; any miss marks the run failed
    if pg_dump -Fc -d "$db" -f "$f" && [ -s "$f" ] && rclone copyto "$f" "s3:$S3_BUCKET/$db/$db-$ts.dump"; then
      echo "backup ok $db-$ts.dump ($(du -h "$f" | cut -f1))"
    else
      echo "backup FAILED for $db" >&2
      failed=1
    fi
    rm -f "$f"
  done
  # Never delete old backups after a failed run: the old ones may be all we have.
  if [ "$failed" -eq 0 ]; then
    rclone delete --min-age "${KEEP_DAYS}d" --include "*.dump" "s3:$S3_BUCKET" || echo "retention sweep failed" >&2
  else
    echo "retention sweep SKIPPED (this run failed)" >&2
  fi
  return "$failed"
}

[ "${1:-}" = "--once" ] && { run_once; exit $?; }
while true; do run_once || true; sleep "$INTERVAL_S"; done
