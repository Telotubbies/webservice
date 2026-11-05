#!/usr/bin/env bash
# First-boot only: a separate database + role for Keycloak (prod overlay).
# Keycloak's dev mode keeps users in an in-container H2 file that is lost on
# recreate; production stores the realm here. Skipped when no password is
# mounted (dev compose), so the dev stack is unchanged.
set -euo pipefail
pw_file="${KC_DB_PASSWORD_FILE:-}"
if [ -z "$pw_file" ] || [ ! -s "$pw_file" ]; then
  echo "02-keycloak: KC_DB_PASSWORD_FILE not mounted — skipping"
  exit 0
fi
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v kc_pw="$(cat "$pw_file")" <<'SQL'
CREATE ROLE keycloak LOGIN PASSWORD :'kc_pw' NOSUPERUSER NOCREATEROLE NOCREATEDB;
CREATE DATABASE keycloak OWNER keycloak;
SQL
