"""Web bundle budget + ops-wall LCP (v4 T13).

- Entry (main) JS chunk <= 600 KB on the wire, gzip — measured against
  what nginx actually serves (Accept-Encoding: gzip, raw byte count).
- Largest Contentful Paint on the ops wall (/), measured with a real
  browser via Playwright when it's resolvable (PLAYWRIGHT_PATH or the
  UAT's node_modules path); otherwise the test skips with the manual
  measurement note.
"""

from __future__ import annotations

import os
import re
import subprocess
import urllib.request
from pathlib import Path

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.perf]

MAIN_CHUNK_BUDGET = 600 * 1024   # 600 KB gz
LCP_BUDGET_MS = 10_000           # sanity bound for a local stack; reported
UAT_PLAYWRIGHT = ("/home/supawich/Desktop/adas/hmi/web/node_modules"
                  "/playwright/index.mjs")
LCP_SCRIPT = Path(__file__).resolve().parent / "lcp.mjs"


def _raw_get(url: str, accept_gzip: bool = True) -> tuple[bytes, dict]:
    req = urllib.request.Request(url)
    if accept_gzip:
        req.add_header("Accept-Encoding", "gzip")
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.read(), dict(r.headers)


def test_main_chunk_under_600kb_gz(web_url):
    html, _ = _raw_get(f"{web_url}/", accept_gzip=False)
    srcs = re.findall(rb'src="(/assets/[^"]+\.js)"', html)
    assert srcs, "no /assets/*.js script tags in index.html"
    total = 0
    sizes = {}
    for s in srcs:
        body, hdrs = _raw_get(f"{web_url}{s.decode()}")
        assert "gzip" in hdrs.get("Content-Encoding", ""), \
            f"{s}: not gzipped on the wire ({hdrs.get('Content-Encoding')})"
        sizes[s.decode()] = len(body)
        total += len(body)
    entry = srcs[0].decode()
    entry_kb = sizes[entry] / 1024
    per = {k.rsplit('/', 1)[-1]: f"{v // 1024}KB" for k, v in sizes.items()}
    print(f"\nPERF web.entry_chunk_gz: {entry_kb:.0f}KB "
          f"(budget {MAIN_CHUNK_BUDGET // 1024}KB); "
          f"all-js total {total / 1024:.0f}KB over {len(sizes)} chunk(s) "
          f"{per}")
    assert sizes[entry] <= MAIN_CHUNK_BUDGET, \
        f"entry chunk {entry_kb:.0f}KB exceeds 600KB gz budget"


def test_ops_wall_lcp(web_url):
    pw = os.environ.get("PLAYWRIGHT_PATH") or (
        UAT_PLAYWRIGHT if Path(UAT_PLAYWRIGHT).exists() else None)
    if not pw or not Path(pw).exists():
        pytest.skip(
            "playwright not resolvable — manual LCP: open DevTools > "
            "Lighthouse on http://localhost:5173 with the stack running; "
            "record 'Largest Contentful Paint' on the ops wall")
    out = subprocess.run(
        ["node", str(LCP_SCRIPT)],
        env={**os.environ, "PLAYWRIGHT_PATH": pw, "WEB_URL": web_url},
        capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, f"lcp.mjs failed:\n{out.stdout}\n{out.stderr}"
    m = re.search(r"LCP_MS=(\d+)", out.stdout)
    assert m, f"no LCP_MS in probe output:\n{out.stdout}\n{out.stderr}"
    lcp = int(m.group(1))
    print(f"\nPERF web.ops_wall_lcp: {lcp}ms "
          f"(sanity bound {LCP_BUDGET_MS}ms — local stack)")
    assert 0 < lcp <= LCP_BUDGET_MS
