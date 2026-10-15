#!/usr/bin/env bash
# One-time Garage setup: layout, bucket, and a key that can only touch it.
# Usage: ./init.sh [capacity, default 100G] — prints the key id + secret ONCE;
# store them as backup_s3_key_id / backup_s3_secret on the console host.
set -euo pipefail
G="docker compose exec -T garage /garage"
CAP="${1:-100G}"
NODE="$($G status 2>/dev/null | awk '/NO ROLE ASSIGNED|HEALTHY NODES/ {f=1} f && $1 ~ /^[0-9a-f]{16}$/ {print $1; exit}')"
[ -n "$NODE" ] || { echo "could not read node id — run: $G status"; exit 1; }
$G layout assign -z dc1 -c "$CAP" "$NODE"
$G layout apply --version 1
$G bucket create wds-backups
$G key create wds-backup
$G bucket allow --read --write wds-backups --key wds-backup
echo "Done. The key above (Key ID + Secret key) goes into the console's backup secrets."
