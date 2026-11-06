#!/usr/bin/env bash
# Unit coverage per package: backend (contract+tenancy), edge-bridge, web.
# Usage: scripts/coverage.sh [--check]   (--check fails below the floors)
# Test-only deps NOT yet in tests/requirements.txt: coverage>=7 (python).
# Web uses `bun test --coverage` (built in; counts only files a test loads).
set -euo pipefail
cd "$(dirname "$0")/.."
PY="${PY:-$( [ -x .venv/Scripts/python.exe ] && echo .venv/Scripts/python.exe || ([ -x .venv/bin/python ] && echo .venv/bin/python || echo python3))}"
export PYTHONUTF8=1
# floors = measured on 2026-11-06 minus 2 points (see QA-report.md)
FLOOR_BE=${FLOOR_BE:-48} FLOOR_EB=${FLOOR_EB:-72} FLOOR_WEB=${FLOOR_WEB:-89}
CHECK=0; [ "${1:-}" = "--check" ] && CHECK=1
fail=0
gate() { # name pct floor
  printf '%-12s %6s%%  (floor %s)\n' "$1" "$2" "$3"
  if [ "$CHECK" = 1 ] && awk "BEGIN{exit !($2 < $3)}"; then echo "  BELOW FLOOR"; fail=1; fi
}
pct() { "$PY" -m coverage report --data-file="$1" | awk '/^TOTAL/{gsub("%","",$NF); print $NF}'; }

( cd tests && "$PY" -m coverage run --data-file=../.cov_be --source=../backend/app \
    -m pytest contract tenancy -q -p no:cacheprovider >/dev/null )
# edge-bridge unit tests live in edge-bridge/tests and in the contract files that import it
EB_TESTS=$(grep -l edge_bridge tests/contract/*.py | tr '\n' ' ')
PYTHONPATH="$PWD/edge-bridge$("$PY" -c "import os;print(os.pathsep,end='')")${PYTHONPATH:-}" "$PY" -m coverage run --data-file=.cov_eb --source=edge-bridge/edge_bridge \
    -m pytest edge-bridge/tests $EB_TESTS -q -p no:cacheprovider >/dev/null
WEB=$( cd web && bun test --coverage 2>&1 | awk -F'|' '/All files/{gsub(/ /,"",$3); print $3}' )

gate backend "$(pct .cov_be)" "$FLOOR_BE"
gate edge-bridge "$(pct .cov_eb)" "$FLOOR_EB"
gate web-lines "$WEB" "$FLOOR_WEB"
rm -f .cov_be .cov_eb
exit $fail
