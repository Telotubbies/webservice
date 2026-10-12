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
# Usage: ./infra/gen-secrets.sh [--force]
#   Default: create only MISSING files (safe to re-run).
#   --force: rotate every file — after --force you MUST recreate the dynsec
#   state (`docker compose down -v` wipes the dynsec-* volumes; the broker
#   re-inits dynamic-security.json from the mounted secret on next boot).
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

# The dev-seeded edge's first dynsec username is deterministic
# (edge-{V1_EDGE_ID}-v1, doc 17 §2) — write it as a secret file so compose
# mounts it like every other identity; no secrets differ in kind.
EDGE_UUID="${V1_EDGE_ID:-0199d000-0000-7000-8000-00000000c001}"
printf 'edge-%s-v1' "$EDGE_UUID" > "$DIR/edge_bootstrap_user"
chmod 0644 "$DIR/edge_bootstrap_user"
echo "  wrote $DIR/edge_bootstrap_user"

echo "infra/secrets ready. NOTE: if the dynsec volume already exists it keeps"
echo "its old admin password — 'docker compose down -v' after rotating."
