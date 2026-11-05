#!/usr/bin/env bash
# One-time dev Garage setup: layout, the artifact bucket and a key scoped to it.
# Writes the key to .env.garage (git-ignored). Safe to re-run.
set -euo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash must not rewrite /garage
C="docker compose -f docker-compose.yml -f docker-compose.garage.yml"
G="$C exec -T garage /garage"
NODE="$($G status 2>/dev/null | awk '$1 ~ /^[0-9a-f]{16}$/ {print $1; exit}')"
[ -n "$NODE" ] || { echo "garage not up: $C up -d garage"; exit 1; }
$G layout show 2>/dev/null | grep -q "$NODE" && ! $G layout show | grep -q "NO ROLE" || { $G layout assign -z dc1 -c 5G "$NODE"; $G layout apply --version 1 || true; }
$G bucket create wds-artifacts 2>/dev/null || true
if [ ! -f .env.garage ]; then
  OUT="$($G key create wds-app)"
  KID="$(echo "$OUT" | awk '/Key ID/ {print $NF}')"
  SEC="$(echo "$OUT" | awk '/Secret key/ {print $NF}')"
  printf 'ARTIFACT_S3_KEY_ID=%s\nARTIFACT_S3_SECRET=%s\n' "$KID" "$SEC" > .env.garage
fi
$G bucket allow --read --write wds-artifacts --key wds-app
echo "ok: .env.garage written; export it, then recreate the backend."
