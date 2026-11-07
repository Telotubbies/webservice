#!/usr/bin/env bash
# Read-only preflight checks before a deploy. Prints a PASS/FAIL table and
# exits non-zero if any check fails. Never writes anything.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SECRETS_DIR="${SECRETS_DIR:-$ROOT/infra/secrets}"
CERTS_DIR="${CERTS_DIR:-$ROOT/infra/certs}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
if [[ -f "$ROOT/.env" ]]; then set -a; . "$ROOT/.env"; set +a; fi
[[ "$SECRETS_DIR" = /* ]] || SECRETS_DIR="$ROOT/$SECRETS_DIR"
[[ "$CERTS_DIR" = /* ]] || CERTS_DIR="$ROOT/$CERTS_DIR"
[[ "$BACKUP_DIR" = /* ]] || BACKUP_DIR="$ROOT/$BACKUP_DIR"

required_secrets=(
  pg_super_pw wds_owner_pw wds_app_pw wds_system_pw
  kc_admin_pw kc_demo_pw svc_backend_pw svc_dynsec_admin_pw
  edge_bootstrap_user edge_bootstrap_pw data_source_key
)

fail=0

printf '%-46s %s\n' "CHECK" "STATUS"
printf '%-46s %s\n' "----------------------------------------------" "------"

run_check() {
  local name="$1"; shift
  local rc=0
  "$@" || rc=$?
  if (( rc == 0 )); then
    printf '%-46s %s\n' "$name" "PASS"
  else
    printf '%-46s %s\n' "$name" "FAIL"
    fail=1
  fi
}

check_secret_files() {
  local f missing=()
  for f in "${required_secrets[@]}"; do
    [[ -s "$SECRETS_DIR/$f" ]] || missing+=("$f")
  done
  if (( ${#missing[@]} > 0 )); then
    echo "missing or empty secret files: ${missing[*]}" >&2
    return 1
  fi
  [[ -d "$SECRETS_DIR" ]]
}

check_cert_files() {
  local f
  for f in ca.crt server.crt server.key; do
    [[ -s "$CERTS_DIR/$f" ]] || { echo "missing or empty cert: $f" >&2; return 1; }
  done
  return 0
}

check_ca_key_not_in_certs() {
  if find "$CERTS_DIR" -type f -name 'ca.key' -print -quit 2>/dev/null | grep -q .; then
    echo "ca.key found inside mounted certs dir: $CERTS_DIR" >&2
    return 1
  fi
  return 0
}

check_compose_config() {
  command -v docker >/dev/null 2>&1 || { echo "docker CLI not found" >&2; return 1; }
  docker compose -f "$ROOT/docker-compose.yml" config >/dev/null 2>&1 || {
    echo "docker compose config failed" >&2
    return 1
  }
  if [[ -f "$ROOT/docker-compose.prod.yml" && -n "${PUBLIC_URL:-}" ]]; then
    docker compose -f "$ROOT/docker-compose.yml" -f "$ROOT/docker-compose.prod.yml" config >/dev/null 2>&1 || {
      echo "prod compose config failed" >&2
      return 1
    }
  fi
  return 0
}

alembic_python() {
  local c
  for c in python3 python; do
    if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import alembic' >/dev/null 2>&1; then
      echo "$c"; return 0
    fi
  done
  return 1
}

alembic_repo_head() {
  local py
  py=$(alembic_python 2>/dev/null) || { echo ""; return 0; }
  [[ -n "$py" ]] || { echo ""; return 0; }
  "$py" - "$ROOT/backend/migrations" <<'PY'
import sys
try:
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    cfg = Config()
    cfg.set_main_option("script_location", sys.argv[1])
    heads = ScriptDirectory.from_config(cfg).get_heads()
    if len(heads) == 1:
        print(heads[0])
except Exception:
    pass
PY
}

check_alembic_head() {
  local repo_head file_head candidate=""
  for c in "${MIGRATIONS_HEAD_FILE:-}" "$ROOT/backend/migrations/HEAD" "$ROOT/MIGRATIONS_HEAD" "$ROOT/infra/migrations-head" "$ROOT/infra/migrations/HEAD"; do
    [[ -n "$c" ]] || continue
    [[ -f "$c" ]] || continue
    candidate="$c"; break
  done

  if [[ -z "$candidate" && -f "$ROOT/tests/contract/test_migrations_layout.py" ]]; then
    file_head=$(sed -n 's/^HEAD = "\([^"]*\)".*/\1/p' "$ROOT/tests/contract/test_migrations_layout.py" | head -n1)
    candidate="tests/contract/test_migrations_layout.py (HEAD constant)"
  elif [[ -n "$candidate" ]]; then
    file_head=$(sed -n '1p' "$candidate" | awk '{print $1}')
  fi

  if [[ -z "${file_head:-}" ]]; then
    echo "no migrations HEAD file found" >&2
    return 1
  fi
  repo_head=$(alembic_repo_head)
  if [[ -z "$repo_head" ]]; then
    echo "could not compute alembic head from repo" >&2
    return 1
  fi
  if [[ "$repo_head" != "$file_head" ]]; then
    echo "alembic head mismatch: repo=$repo_head file=$file_head ($candidate)" >&2
    return 1
  fi
  return 0
}

check_disk_space() {
  local avail
  avail=$(df -kP "$ROOT" 2>/dev/null | awk 'NR==2 {print $4}')
  if [[ -z "$avail" ]]; then
    echo "df unavailable" >&2
    return 1
  fi
  if (( avail < 1048576 )); then
    echo "low disk space: ${avail}KB available (<1048576KB)" >&2
    return 1
  fi
  return 0
}

check_latest_backup() {
  local latest
  latest=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.dump' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n1 | cut -d' ' -f2-)
  if [[ -z "$latest" ]]; then
    echo "no backup dump found in $BACKUP_DIR" >&2
    return 1
  fi
  if [[ ! -s "$latest" ]]; then
    echo "latest backup is empty: $latest" >&2
    return 1
  fi
  if find "$latest" -mmin +1560 2>/dev/null | grep -q .; then
    echo "latest backup older than 26h: $latest" >&2
    return 1
  fi
  return 0
}

run_check "required secret files" check_secret_files
run_check "required cert files" check_cert_files
run_check "docker compose config" check_compose_config
run_check "alembic head == migrations HEAD" check_alembic_head
run_check "disk space (>=1GiB)" check_disk_space
run_check "latest backup <26h & non-empty" check_latest_backup
run_check "ca.key not in certs dir" check_ca_key_not_in_certs

echo
if (( fail == 0 )); then
  echo "RESULT: PASS"
  exit 0
else
  echo "RESULT: FAIL"
  exit 1
fi
