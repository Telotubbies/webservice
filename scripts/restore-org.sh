#!/usr/bin/env bash
# Recover ONE organisation from a full dump (option A in docs/data-architecture.md 3.6).
# Restores the dump into a THROWAWAY database, copies that org's rows out as CSV, drops the
# scratch database. It never writes to the live `wds` database; loading the CSVs back is a
# deliberate, reviewed step.      DUMP=backups/wds-<ts>.dump ORG_ID=<uuid> ./scripts/restore-org.sh
set -euo pipefail
DUMP="${DUMP:?set DUMP=path/to/dump}"
ORG_ID="${ORG_ID:?set ORG_ID=<org uuid>}"
case "$ORG_ID" in *[!0-9a-fA-F-]*|"") echo "ORG_ID must be a uuid" >&2; exit 2;; esac
OUT="${OUT:-restore-org-$ORG_ID}"
SCRATCH="wds_orgrestore_$(date -u +%s)"
PSQL="${PSQL:-docker compose exec -T postgres psql -U postgres}"
RESTORE="${RESTORE:-docker compose exec -T postgres pg_restore -U postgres}"
cleanup() { $PSQL -d postgres -c "DROP DATABASE IF EXISTS $SCRATCH" >/dev/null; }
trap cleanup EXIT
mkdir -p "$OUT"
$PSQL -d postgres -c "CREATE DATABASE $SCRATCH" >/dev/null
$RESTORE --no-owner -d "$SCRATCH" < "$DUMP"
for t in $($PSQL -d "$SCRATCH" -Atc "SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name NOT LIKE 'tag_history_%' GROUP BY 1 ORDER BY 1"); do
  $PSQL -d "$SCRATCH" -c "COPY (SELECT * FROM \"$t\" WHERE org_id = '$ORG_ID') TO STDOUT WITH CSV HEADER" > "$OUT/$t.csv"
  echo "$t: $(($(wc -l < "$OUT/$t.csv") - 1)) rows"
done
echo "org $ORG_ID written to $OUT/ (scratch DB dropped); live database untouched"