#!/usr/bin/env bash
# Dependency + image audit (F21). Each tool runs only if it is installed; nothing is installed for you.
#   scripts/security/audit.sh            # pip-audit on the backend + converter requirements, trivy on the repo
set -u
cd "$(dirname "$0")/../.."
rc=0
if command -v pip-audit >/dev/null; then
  for f in backend/requirements.txt model-converter/requirements.txt; do
    echo "== pip-audit $f"; pip-audit -r "$f" --disable-pip || rc=1
  done
else echo "pip-audit not installed: pip install pip-audit" >&2; rc=2; fi
if command -v trivy >/dev/null; then
  echo "== trivy fs"; trivy fs --scanners vuln,secret,misconfig --severity HIGH,CRITICAL --exit-code 1 . || rc=1
else echo "trivy not installed" >&2; rc=2; fi
if command -v gitleaks >/dev/null; then
  echo "== gitleaks"; gitleaks detect --no-banner || rc=1
fi
exit $rc