#!/usr/bin/env bash
# Generate infra/secrets/ (gitignored) — one file per MQTT identity secret.
# Dynamic-security identities (v4 T6, doc 17 §2):
#
#   svc_backend_pw       svc-backend      ingest + command publish
#   svc_dynsec_admin_pw  svc-dynsec-admin $CONTROL/dynamic-security only
#   edge_bootstrap_pw    edge-{seed}-v1   the dev-seeded edge's first credential
#   mqtt_hc_pw           reserved         broker healthcheck client (future)
#   tester_pw            tester           fault injection — TEST PROFILE ONLY
#
# Env-derived secrets (v4 T7) — value comes from the env var if set, else the
# documented dev default. Keeping them as mounted FILES (not env vars) is what
# keeps passwords out of `docker inspect`:
#
#   pg_super_pw     POSTGRES_SUPERUSER_PASSWORD  postgres-dev-pass
#   wds_owner_pw    WDS_OWNER_PASSWORD           owner-dev-pass
#   wds_app_pw      WDS_APP_PASSWORD             app-dev-pass
#   wds_system_pw   WDS_SYSTEM_PASSWORD          system-dev-pass
#   kc_admin_pw     KC_ADMIN_PASSWORD            admin-dev-pass
#   kc_demo_pw      KC_DEMO_PASSWORD             kc-demo-pass
#
# PROD: set the env vars to real values BEFORE `make secrets` (or overwrite
# the files) — APP_ENV=prod refuses to boot while any file still holds a
# documented dev default. Rotating a Postgres/Keycloak password later means
# changing it in the DB/realm too — these files are the deploy-time input,
# not a rotation mechanism.
#
# Usage: ./infra/gen-secrets.sh [--force]
#   Default: create only MISSING files (safe to re-run).
#   --force: rotate every file — after --force you MUST recreate the dynsec
#   state. Scoped rebuild (broker re-inits dynamic-security.json from the
#   mounted secret on next boot):
#       docker compose stop mosquitto
#       docker volume rm webservice_mosquitto-data   # dynsec cache ONLY
#       docker compose up -d mosquitto
#   WARNING: do NOT use `docker compose down -v` for rotation — it also
#   deletes webservice_pgdata = ALL database rows. Data loss.
set -euo pipefail
cd "$(dirname "$0")/.."

DIR=infra/secrets
mkdir -p "$DIR"
chmod 0700 "$DIR"

gen() { # gen <file>
  if [ ! -s "$DIR/$1" ] || [ "${FORCE:-0}" = "1" ]; then
    openssl rand -base64 32 | tr -d '=\n' | cut -c1-40 > "$DIR/$1"
    chmod 0644 "$DIR/$1"   # containers read /run/secrets as non-root
    echo "  wrote $DIR/$1"
  fi
}

[ "${1:-}" = "--force" ] && FORCE=1

for f in svc_backend_pw svc_dynsec_admin_pw edge_bootstrap_pw mqtt_hc_pw tester_pw; do
  gen "$f"
done

# Env-derived secrets: real value from the env var when set, else the
# documented dev default so `make up` works with zero configuration (dev).
gen_env() { # gen_env <file> <ENVVAR> <dev-default>
  if [ ! -s "$DIR/$1" ] || [ "${FORCE:-0}" = "1" ]; then
    eval "printf '%s' \"\${$2:-$3}\"" > "$DIR/$1"
    chmod 0644 "$DIR/$1"
    echo "  wrote $DIR/$1"
  fi
}

gen_env pg_super_pw    POSTGRES_SUPERUSER_PASSWORD postgres-dev-pass
gen_env wds_owner_pw   WDS_OWNER_PASSWORD          owner-dev-pass
gen_env wds_app_pw     WDS_APP_PASSWORD            app-dev-pass
gen_env wds_system_pw  WDS_SYSTEM_PASSWORD         system-dev-pass
gen_env kc_admin_pw    KC_ADMIN_PASSWORD           admin-dev-pass
gen_env kc_demo_pw     KC_DEMO_PASSWORD            kc-demo-pass

# The dev-seeded edge's first dynsec username is deterministic
# (edge-{V1_EDGE_ID}-v1, doc 17 §2) — write it as a secret file so compose
# mounts it like every other identity; no secrets differ in kind.
EDGE_UUID="${V1_EDGE_ID:-0199d000-0000-7000-8000-00000000c001}"
printf 'edge-%s-v1' "$EDGE_UUID" > "$DIR/edge_bootstrap_user"
chmod 0644 "$DIR/edge_bootstrap_user"
echo "  wrote $DIR/edge_bootstrap_user"

echo "infra/secrets ready. NOTE: if the dynsec volume already exists it keeps"
echo "its old admin password — after rotating: 'docker compose stop mosquitto'"
echo "+ 'docker volume rm webservice_mosquitto-data' + 'docker compose up -d'"
echo "mosquitto — NEVER 'down -v' (that wipes pgdata = all DB rows)."
