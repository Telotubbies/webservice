#!/usr/bin/env python3
"""Pin check (F21): fail on anything that is not pinned.
 - requirements*.txt: every requirement must be `name==version` (extras allowed)
 - Dockerfiles: FROM must carry a version tag other than `latest` (a digest is better)
 - GitHub workflows: `uses:` should name a full commit SHA, not a tag or branch
Prints each finding; --strict makes the workflow rule fatal (default is a warning, because pinning
actions by SHA needs a lookup that cannot be done offline).
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REQ = re.compile(r"^[A-Za-z0-9_.\-]+(\[[^\]]+\])?==[^\s;#]+")
STRICT = "--strict" in sys.argv


def main() -> int:
    files = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.splitlines()
    errors, warns = [], []
    for f in files:
        p = ROOT / f
        name = p.name
        if re.fullmatch(r"requirements.*\.txt", name):
            for n, line in enumerate(p.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
                s = line.strip()
                if s and not s.startswith(("#", "-")) and not REQ.match(s):
                    errors.append(f"{f}:{n}: not pinned with ==: {s}")
        elif name == "Dockerfile" or name.startswith("Dockerfile."):
            for n, line in enumerate(p.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
                m = re.match(r"(?i)^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)", line)
                if m and "@sha256:" not in m.group(1):
                    img = m.group(1)
                    if img.lower() == "scratch" or " AS " in line.upper() and ":" not in img and "/" not in img and img.isidentifier():
                        continue                                  # a previous build stage
                    if ":" not in img.split("/")[-1] or img.endswith(":latest"):
                        errors.append(f"{f}:{n}: image without a version tag: {img}")
        elif f.startswith(".github/workflows/") and name.endswith((".yml", ".yaml")):
            for n, line in enumerate(p.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
                m = re.search(r"uses:\s*([\w.\-/]+)@(\S+)", line)
                if m and not re.fullmatch(r"[0-9a-f]{40}", m.group(2)):
                    (errors if STRICT else warns).append(f"{f}:{n}: action not pinned to a commit SHA: {m.group(1)}@{m.group(2)}")
    for w in warns:
        print("warn ", w)
    for e in errors:
        print("FAIL ", e)
    print(f"check-pins: {len(errors)} error(s), {len(warns)} warning(s)", file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
