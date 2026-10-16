"""Migration directory invariants: SQL twins present, one linear chain, no duplicate ids."""

from __future__ import annotations

import re
from pathlib import Path

VERSIONS = Path(__file__).resolve().parents[2] / "backend" / "migrations" / "versions"
HEAD = "0013"


def _migrations() -> dict[str, tuple[str | None, Path]]:
    out: dict[str, tuple[str | None, Path]] = {}
    for py in sorted(VERSIONS.glob("[0-9][0-9][0-9][0-9]_*.py")):
        src = py.read_text(encoding="utf-8")
        rev = re.search(r'^revision\s*=\s*"(\w+)"', src, re.M).group(1)
        down = re.search(r'^down_revision\s*=\s*(None|"(\w+)")', src, re.M)
        assert rev not in out, f"duplicate revision id {rev}"
        out[rev] = (down.group(2), py)
    return out


def test_every_py_migration_with_sql_twin_has_it():
    for _, (_, py) in _migrations().items():
        if "with_name(" in py.read_text(encoding="utf-8"):
            assert py.with_suffix(".sql").exists(), f"{py.name} has no .sql twin"


def test_revision_chain_is_linear_to_head():
    m = _migrations()
    roots = [r for r, (d, _) in m.items() if d is None]
    assert len(roots) == 1
    children: dict[str, list[str]] = {}
    for r, (d, _) in m.items():
        if d:
            assert d in m, f"{r} points at missing {d}"
            children.setdefault(d, []).append(r)
    assert all(len(c) == 1 for c in children.values()), "branch in revision chain"
    cur = roots[0]
    while cur in children:
        cur = children[cur][0]
    assert cur == HEAD


def test_no_duplicate_revision_ids():
    _migrations()  # asserts on duplicates
