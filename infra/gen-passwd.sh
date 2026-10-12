#!/usr/bin/env bash
# Generate infra/passwd (mosquitto password file) — gitignored, demo creds.
# Usage: ./infra/gen-passwd.sh [edge_pw] [backend_pw] [tester_pw]
# Defaults match .env.example. Never use these values in production.
set -euo pipefail
cd "$(dirname "$0")/.."

EDGE_PW="${1:-edge-demo-pass}"
BACKEND_PW="${2:-backend-demo-pass}"
TESTER_PW="${3:-tester-demo-pass}"

# mosquitto_passwd -c creates the file with the FIRST user; -b appends.
docker run --rm -v "$PWD/infra:/work" -w /work eclipse-mosquitto:2 \
  mosquitto_passwd -c -b passwd backend "$BACKEND_PW"
docker run --rm -v "$PWD/infra:/work" -w /work eclipse-mosquitto:2 \
  mosquitto_passwd -b passwd edge1 "$EDGE_PW"
docker run --rm -v "$PWD/infra:/work" -w /work eclipse-mosquitto:2 \
  mosquitto_passwd -b passwd tester "$TESTER_PW"

echo "infra/passwd generated (edge1 / backend / tester)."
