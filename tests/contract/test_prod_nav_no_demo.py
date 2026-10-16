"""Phase 4 guardrail: pages reachable from production navigation
(VITE_FEATURES empty → every `flag:`-gated nav item and route is hidden)
must never import demo/mock/local-fixture modules — "a paying customer
must never see fake numbers".

Static analysis, no bundler:
  1. app/nav.ts  → collect `to:` of nav items WITHOUT a `flag:` (also inside
     `sections:`/`secondary:`/`action:` — all are prod-visible).
  2. App.tsx     → map each prod path to the component it renders
     (`<Route index|path="x" element={page(C)|<C ...>}`, but only when the
     route is NOT wrapped in `{enabled('…') && …}`).
  3. Resolve the component's module (lazy `import('./features/…')` or
     direct `import … from '…'`) and walk the TS import graph.
  4. Assert the closure contains no file in FORBIDDEN.

Known mismatch surfaced by this test, kept explicit instead of hidden:
  nav '/downtimes' is unflagged but its route is `enabled('downtimes')` —
  the controller decides whether nav gains `flag:'downtimes'` or the route
  ungates. Until then the test treats that entry as gated (the ROUTE is
  the customer-visible gate) via KNOWN_NAV_ROUTE_FLAG_MISMATCH.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SRC = REPO / "web" / "src"
NAV = SRC / "app" / "nav.ts"
APP = SRC / "App.tsx"

# Modules that serve fake or device-local fixture data. Prod-reachable
# pages must never pull these into a bundle a customer downloads.
FORBIDDEN = {
    "features/errors/errors.mock.ts",
    "features/logs/logs.mock.ts",
    "features/teams/roster.ts",
}
FORBIDDEN_RE = re.compile(r"\.mock\.[tj]sx?$")

# nav `to` values whose ROUTE is flag-gated even though the nav item isn't —
# each entry here is an acknowledged controller TODO, not a silent pass.
KNOWN_NAV_ROUTE_FLAG_MISMATCH: dict[str, str] = {}

_ITEM_TO = re.compile(r"""to:\s*['"]([^'"?]+)""")
_FLAG = re.compile(r"""flag:\s*['"]([a-z]+)['"]""")
# <Route index|path="x" element={page(C)|<C/>|<Wrap><C/></Wrap>} /> optionally
# preceded by an {enabled('flag') && } gate.
_ROUTE = re.compile(
    r"""(?:\{enabled\(\s*['"]([a-z]+)['"]\s*\)\s*&&\s*)?"""
    r"""<Route\s+(index|path="([^"]*)")\s+element=\{(.+?)\}\s*/>""",
    re.S)
_WRAPPERS = {"RouteBoundary", "Suspense", "Navigate", "Boot", "Shell", "RouteError"}


def _nav_prod_paths() -> set[str]:
    """`to:` values that have no `flag:` on the same {...} item. nav.ts puts
    one item per line — flag-less lines are prod-visible."""
    out: set[str] = set()
    for line in NAV.read_text(encoding="utf-8").splitlines():
        m = _ITEM_TO.search(line)
        if not m:
            continue
        if not _FLAG.search(line):
            out.add(m.group(1))
    return out


def _element_component(expr: str) -> str | None:
    """First page component inside the element expression."""
    m = re.search(r"page\((\w+)\)", expr)
    if m:
        return m.group(1)
    for name in re.findall(r"<([A-Z]\w+)", expr):
        if name not in _WRAPPERS:
            return name
    return None


def _app_routes() -> dict[str, tuple[str, str | None]]:
    """path -> (component, flag|None). `index` maps to '/'."""
    routes: dict[str, tuple[str, str | None]] = {}
    for m in _ROUTE.finditer(APP.read_text(encoding="utf-8")):
        flag, index_or_path, path, element = m.groups()
        p = "/" if index_or_path == "index" else f"/{path}"
        comp = _element_component(element)
        if comp is not None:
            routes[p] = (comp, flag)
    return routes


def _component_file(comp: str, app_src: str) -> Path | None:
    """Component name → module path, via lazy or direct import."""
    # lazy: const X = lazy(() => import('./features/a/B').then(...))
    m = re.search(
        rf"const\s+{re.escape(comp)}\s*=\s*lazy\(\(\)\s*=>\s*import\(['\"]([^'\"]+)['\"]",
        app_src)
    if m:
        return _resolve(SRC, m.group(1))
    # direct: import { X } from './features/a/B'  /  import X from '...'
    for pat in (
        rf"import\s+\{{[^}}]*\b{re.escape(comp)}\b[^}}]*\}}\s+from\s+['\"]([^'\"]+)['\"]",
        rf"import\s+{re.escape(comp)}\s+from\s+['\"]([^'\"]+)['\"]",
    ):
        m = re.search(pat, app_src, re.S)
        if m:
            return _resolve(SRC, m.group(1))
    return None


def _resolve(base: Path, spec: str) -> Path | None:
    p = (base / spec).resolve() if spec.startswith(".") else (SRC / spec).resolve()
    for cand in (p.with_suffix(".ts"), p.with_suffix(".tsx"),
                 p / "index.ts", p / "index.tsx"):
        if cand.exists():
            return cand
    return None


_IMPORT = re.compile(
    r"""(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]""",
    re.S)


def _transitive(entry: Path) -> set[Path]:
    seen: set[Path] = set()
    stack = [entry]
    while stack:
        f = stack.pop()
        if f in seen or not f.exists():
            continue
        seen.add(f)
        try:
            src = f.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for m in _IMPORT.finditer(src):
            spec = m.group(1) or m.group(2)
            if not spec or not spec.startswith("."):
                continue
            r = _resolve(f.parent, spec)
            if r and r not in seen:
                stack.append(r)
    return seen


def _all_prod_entries() -> dict[str, Path]:
    nav_paths = _nav_prod_paths()
    routes = _app_routes()
    app_src = APP.read_text(encoding="utf-8")
    entries: dict[str, Path] = {}
    for to in nav_paths:
        if to in KNOWN_NAV_ROUTE_FLAG_MISMATCH:
            continue  # route is flag-gated: nav item renders but dead-ends —
                      # controller fix tracked in KNOWN_NAV_ROUTE_FLAG_MISMATCH
        hit = routes.get(to)
        if hit is None:
            continue  # nav alias without a dedicated route (e.g. section
                      # links to another page's query string form)
        comp, flag = hit
        if flag is not None:
            continue  # route gated in prod anyway
        f = _component_file(comp, app_src)
        if f is not None:
            entries[to] = f
    return entries


def test_nav_routes_resolve():
    """Sanity: most unflagged nav paths must map to a resolvable module —
    a silent zero here would make the demo check vacuous."""
    assert len(_all_prod_entries()) >= 10


def test_prod_nav_pages_never_import_demo_modules():
    failures = []
    for to, entry in sorted(_all_prod_entries().items()):
        closure = _transitive(entry)
        for f in closure:
            rel = f.relative_to(SRC).as_posix()
            if rel in FORBIDDEN or FORBIDDEN_RE.search(f.name):
                failures.append(f"{to} ({entry.name}) imports demo module {rel}")
    assert not failures, "production-nav page pulls fake data:\n  " + "\n  ".join(failures)


def test_known_nav_route_flag_mismatches_are_still_gated():
    """Entries in KNOWN_NAV_ROUTE_FLAG_MISMATCH must keep their route gated —
    the day a mismatch is FIXED the entry must be removed (stale entries are
    as bad as stale tests)."""
    routes = _app_routes()
    for to, flag in KNOWN_NAV_ROUTE_FLAG_MISMATCH.items():
        comp, route_flag = routes.get(to, (None, None))
        assert route_flag == flag, (
            f"nav {to}: route flag changed from {flag!r} to {route_flag!r} — "
            "remove the entry from KNOWN_NAV_ROUTE_FLAG_MISMATCH")
