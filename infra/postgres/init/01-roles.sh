#!/usr/bin/env bash
# First-boot role bootstrap (ADR-13 §1). Runs once, as the postgres superuser,
# via docker-entrypoint-initdb.d. App containers never receive superuser creds.
#
#   wds_owner  — owns schema; used only by the `migrate` job (Alembic)
#   wds_app    — API request path: DML on tenant tables, NO BYPASSRLS, owns nothing
#   wds_system — background workers: same + narrowly scoped cross-org lookups
set -euo pipefail

: "${WDS_OWNER_PASSWORD:?}" "${WDS_APP_PASSWORD:?}" "${WDS_SYSTEM_PASSWORD:?}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v owner_pw="$WDS_OWNER_PASSWORD" -v app_pw="$WDS_APP_PASSWORD" \
  -v sys_pw="$WDS_SYSTEM_PASSWORD" <<'SQL'
CREATE ROLE wds_owner  LOGIN PASSWORD :'owner_pw' NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
CREATE ROLE wds_app    LOGIN PASSWORD :'app_pw'   NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
CREATE ROLE wds_system LOGIN PASSWORD :'sys_pw'   NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
CREATE DATABASE wds OWNER wds_owner;
SQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname wds <<'SQL'
-- Nobody but the owner may create objects in public.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO wds_owner;
GRANT USAGE ON SCHEMA public TO wds_app, wds_system;
REVOKE ALL ON DATABASE wds FROM PUBLIC;
GRANT CONNECT ON DATABASE wds TO wds_owner, wds_app, wds_system;
SQL
