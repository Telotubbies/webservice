#!/usr/bin/env bash
# Generate infra/certs/ (gitignored): a self-signed dev CA + a mosquitto
# server certificate for the TLS listener on 8883 (v4 T6, doc 17 + doc 20 §3.4).
#
# SANs cover both the container hostname (mosquitto — compose-internal
# clients) and localhost/127.0.0.1 (host-side tests/UAT via the published
# port). Dev-only material — prod uses a real CA (10-aws-deployment).
set -euo pipefail
# Git Bash on Windows rewrites "/CN=..." into a file path; no effect elsewhere.
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."

DIR="${CERTS_DIR:-infra/certs}"
mkdir -p "$DIR"

if [ -f "$DIR/ca.crt" ] && [ -f "$DIR/server.crt" ] && [ -f "$DIR/server.key" ] \
   && [ "${1:-}" != "--force" ]; then
  echo "infra/certs already present — use './infra/gen-certs.sh --force' to reissue."
  exit 0
fi

DAYS="${CERT_DAYS:-3650}"

# Dev CA
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$DIR/ca.key" -out "$DIR/ca.crt" \
  -days "$DAYS" -subj "/CN=wds-dev-ca" 2>/dev/null

# Server key + CSR
openssl req -newkey rsa:2048 -nodes \
  -keyout "$DIR/server.key" -out "$DIR/server.csr" \
  -subj "/CN=mosquitto" 2>/dev/null

# Sign with the CA. SAN: compose hostname + loopback (+ MQTT_PUBLIC_HOST so
# customer edge devices can verify the broker from outside).
# extfile is a real file, not <(...) — process substitution fails on Git Bash.
printf 'subjectAltName=DNS:localhost,DNS:mosquitto,IP:127.0.0.1%s\n' \
  "${MQTT_PUBLIC_HOST:+,DNS:$MQTT_PUBLIC_HOST}" > "$DIR/san.ext"
openssl x509 -req -in "$DIR/server.csr" \
  -CA "$DIR/ca.crt" -CAkey "$DIR/ca.key" -CAcreateserial \
  -out "$DIR/server.crt" -days "$DAYS" -extfile "$DIR/san.ext" 2>/dev/null

rm -f "$DIR/server.csr" "$DIR/ca.srl" "$DIR/san.ext"

# The mosquitto container runs as uid 1883 — bind-mounted files must be
# world-readable for it to load them (dev self-signed material only).
chmod 0644 "$DIR"/ca.crt "$DIR"/server.crt "$DIR"/server.key "$DIR"/ca.key 2>/dev/null || true

echo "infra/certs generated (ca.crt, server.crt, server.key — SAN localhost/mosquitto)."
