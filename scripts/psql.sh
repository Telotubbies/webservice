#!/usr/bin/env sh
# psql inside the compose postgres container (no host install needed).
#   scripts/psql.sh                       -> dev stack, interactive, as postgres
#   scripts/psql.sh -c "select 1"         -> extra args pass through to psql
#   PG_CONTAINER=wds-prodtest-postgres-1 scripts/psql.sh   -> other stack
#   PG_USER=wds_app scripts/psql.sh       -> runtime role
exec docker exec -i ${PG_TTY:+-t} "${PG_CONTAINER:-webservice-postgres-1}" \
  psql -U "${PG_USER:-postgres}" -d "${PG_DB:-wds}" "$@"
