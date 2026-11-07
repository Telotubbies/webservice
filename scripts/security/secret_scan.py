#!/usr/bin/env python3
"""Secret scan (F21): fail when a tracked file looks like it holds a credential.
Self-contained so it runs anywhere (CI step, pre-commit). If `gitleaks` is installed, run that
as well: `gitleaks detect --no-banner`. Allow a known-safe line with `# secret-scan: allow` on it,
or list a path in scripts/security/secret-scan.allow.txt.

    python scripts/security/secret_scan.py          # scans `git ls-files`
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RULES = {
    "private key block": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY"),
    "AWS access key id": re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
    "GitHub token": re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,}\b"),
    "Slack token": re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}\b"),
    "Google API key": re.compile(r"\bAIza[0-9A-Za-z_\-]{35}\b"),
    "generic assignment": re.compile(r"""(?i)\b(?:password|passwd|secret|api[_-]?key|token)\b\s*[:=]\s*['"]([^'"\s$<{][^'"\s]{11,})['"]"""),
}
PLACEHOLDER = re.compile(r"(?i)change|example|placeholder|dummy|your[_-]|xxxx|<.*>|\$\{|todo|test|demo|dev|sample|\*{3,}|null|none")
SKIP_SUFFIX = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".glb", ".onnx", ".pt", ".woff", ".woff2", ".lock", ".mp4", ".svg"}


def allowed_paths() -> set[str]:
    f = ROOT / "scripts/security/secret-scan.allow.txt"
    return {ln.strip() for ln in f.read_text(encoding="utf-8").splitlines() if ln.strip() and not ln.startswith("#")} if f.exists() else set()


def scan_text(path: str, text: str) -> list[str]:
    hits = []
    for n, line in enumerate(text.splitlines(), 1):
        if "secret-scan: allow" in line or len(line) > 2000:
            continue
        for name, rx in RULES.items():
            m = rx.search(line)
            if not m:
                continue
            if name == "generic assignment" and PLACEHOLDER.search(m.group(1)):
                continue
            hits.append(f"{path}:{n}: {name}")
    return hits


def main() -> int:
    allow = allowed_paths()
    files = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.splitlines()
    hits: list[str] = []
    for f in files:
        p = ROOT / f
        if f in allow or p.suffix.lower() in SKIP_SUFFIX or not p.is_file() or p.stat().st_size > 1_000_000:
            continue
        try:
            hits += scan_text(f, p.read_text(encoding="utf-8", errors="ignore"))
        except OSError:
            continue
    for h in hits:
        print(h)
    print(f"secret-scan: {len(hits)} finding(s) in {len(files)} files", file=sys.stderr)
    return 1 if hits else 0


if __name__ == "__main__":
    raise SystemExit(main())
