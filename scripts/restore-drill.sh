#!/usr/bin/env bash
# Restore the latest (or given) backup into a THROWAWAY postgres container
# with its own volume, run alembic current + row counts, then tear it down.
# Never touches the real database or the compose project volumes.
# Requires --yes to actually run; otherwise prints what it would do.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

YES=0
DUMP="${DUMP:-}"
POSITIONAL=()
for arg in "$@"; do
  case "$arg" in
    --yes) YES=1 ;;
    --help|-h) echo "usage: DUMP=backups/wds-<ts>.dump $0 [--yes]"; exit 0 ;;
    *) POSITIONAL+=("$arg") ;;
  esac
done
if (( ${#POSITIONAL[@]} > 0 )); then DUMP="${POSITIONAL[0]}"; fi

if [[ -z "$DUMP" ]]; then
  echo "usage: DUMP=backups/wds-<ts>.dump $0 [--yes]" >&2
  exit 2
fi
[[ "$DUMP" = /* ]] || DUMP="$ROOT/$DUMP"

if (( YES != 1 )); then
  cat <<EOF
restore-drill (dry run - pass --yes to execute)
  dump:       $DUMP
  container:  wds-restore-drill-<unique>
  volume:     wds-restore-drill-<unique> (newly created; not a compose project volume)
  network:    wds-restore-drill-<unique> (isolated bridge)
  actions:    create postgres container -> restore dump -> alembic current -> row counts -> drop container/volume/network
  safety:     never touches the real wds database or compose project volumes
EOF
  exit 0
fi

[[ -f "$DUMP" ]] || { echo "dump not found: $DUMP" >&2; exit 1; }
[[ -s "$DUMP" ]] || { echo "dump is empty: $DUMP" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "docker CLI not found" >&2; exit 1; }

drill_id="drill-$(date +%Y%m%d%H%M%S)-$$-${RANDOM}"
container="wds-restore-drill-${drill_id}"
volume="wds-restore-drill-${drill_id}"
network="wds-restore-drill-${drill_id}"
pg_pw="restore-drill-pw"
port="${DRILL_PORT:-55432}"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

echo "== creating throwaway postgres container: $container"
docker network create "$network" >/dev/null
docker volume create "$volume" >/dev/null
docker run -d --name "$container" --network "$network" \
  -p "127.0.0.1:${port}:5432" \
  -e POSTGRES_PASSWORD="$pg_pw" \
  -v "$volume:/var/lib/postgresql/data" \
  postgres:16-alpine >/dev/null

echo "== waiting for postgres readiness"
ready=0
for _ in $(seq 1 60); do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
if (( ready != 1 )); then
  echo "postgres did not become ready" >&2
  exit 1
fi

echo "== creating wds database"
docker exec "$container" psql -U postgres -c "CREATE DATABASE wds;" >/dev/null

echo "== restoring dump: $DUMP"
docker exec -i "$container" pg_restore -U postgres -d wds --no-owner --exit-on-error < "$DUMP"

echo "== alembic current"
if command -v alembic >/dev/null 2>&1; then
  ( cd "$ROOT/backend" && WDS_MIGRATE_DSN="postgresql+psycopg://postgres:${pg_pw}@127.0.0.1:${port}/wds" \
      alembic -c alembic.ini current ) || echo "alembic current failed" >&2
else
  echo "alembic CLI not on PATH; reporting alembic_version table instead:"
  docker exec "$container" psql -U postgres -d wds -c "SELECT version_num FROM alembic_version;" || true
fi

echo "== row counts"
for t in organizations users sites tags tag_history alarm_events; do
  n=$(docker exec "$container" psql -U postgres -d wds -tAc "SELECT count(*) FROM $t;" 2>/dev/null | tr -d '[:space:]' || true)
  if [[ -z "$n" ]]; then n="n/a"; fi
  printf '  %-18s %s\n' "$t" "$n"
done

echo "== restore drill complete: OK"
