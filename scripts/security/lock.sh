#!/usr/bin/env bash
# Hash-pinned lock files (F21): requirements.txt stays the human list; the .lock carries every
# transitive dependency with sha256 hashes, and installs use `pip install --require-hashes -r ....lock`.
# Needs network + pip-tools; run it deliberately and commit the result.
set -euo pipefail
cd "$(dirname "$0")/../.."
command -v pip-compile >/dev/null || { echo "pip install pip-tools first" >&2; exit 2; }
for d in backend model-converter; do
  pip-compile --generate-hashes --allow-unsafe --quiet -o "$d/requirements.lock" "$d/requirements.txt"
  echo "wrote $d/requirements.lock"
done