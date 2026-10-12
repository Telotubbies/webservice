"""Security headers + surface exposure, via the WEB origin (v4 T13).

nginx is the policy point: every response class — SPA HTML, hashed
asset, API JSON (200/401/404), nginx's own 404 (ops paths AND missing
assets), the SPA fallback — must carry CSP + nosniff + frame-deny. The
Keycloak proxy blocks deliberately pass KC's own headers through (KC
owns CSP/XFO on its pages; our SPA CSP would break its login theme), so
KC classes are asserted on KC's own headers instead.

Also asserted: no nginx version banner, machine endpoints absent from
the web origin, docs absent under APP_ENV=prod.
"""

from __future__ import annotations

import re

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.security]

REQUIRED = {
    "content-security-policy": (
        "default-src 'self'", "object-src 'none'", "frame-ancestors 'self'"),
    "x-content-type-options": ("nosniff",),
    "x-frame-options": ("DENY",),
}


def _assert_headers(r, label):
    for name, needles in REQUIRED.items():
        v = r.headers.get(name)
        assert v is not None, f"{label}: missing {name} ({r.status_code})"
        for n in needles:
            assert n in v, f"{label}: {name}={v!r} lacks {n!r}"


@pytest.fixture(scope="module")
def web(web_url):
    httpx = pytest.importorskip("httpx")
    with httpx.Client(base_url=web_url, timeout=10.0) as c:
        yield c


def _entry_asset(web) -> str:
    """Path of the SPA's entry JS bundle from index.html."""
    html = web.get("/").text
    m = re.search(r'src="(/assets/[^"]+\.js)"', html)
    assert m, "no module script in index.html"
    return m.group(1)


def test_spa_document_headers(web):
    r = web.get("/")
    assert r.status_code == 200
    _assert_headers(r, "SPA /")


def test_hashed_asset_headers(web):
    r = web.get(_entry_asset(web))
    assert r.status_code == 200
    _assert_headers(r, "entry asset")
    assert "immutable" in r.headers.get("cache-control", "")


def test_spa_fallback_headers(web):
    r = web.get("/some/deep/spa/route")
    assert r.status_code == 200
    assert "text/html" in r.headers.get("content-type", "")
    _assert_headers(r, "SPA fallback")


def test_asset_404_headers(web):
    r = web.get("/assets/definitely-missing.js")
    assert r.status_code == 404
    _assert_headers(r, "asset 404")


def test_api_json_headers(web):
    for path, label in (("/api/health", "api 200"),
                        ("/api/tags", "api 401 (no auth)"),
                        ("/api/v1/me", "api v1 401")):
        r = web.get(path)
        _assert_headers(r, label)


def test_api_error_response_headers(web):
    """API error classes (401/404/429-shaped) also carry the headers —
    an error page is still a clickjacking/sniffing surface."""
    import conftest
    r = web.get("/api/v1/orgs/00000000-0000-0000-0000-000000000000",
                headers={"Authorization":
                         f"Bearer {conftest.OPERATOR_TOKEN}"})
    assert r.status_code == 404
    _assert_headers(r, "api 404 (non-member org)")
    r = web.post("/api/commands", json={})
    assert r.status_code in (400, 401)
    _assert_headers(r, "api POST unauth")


def test_machine_endpoints_absent_via_web(web):
    """Ops surface is backend-port only — through the web origin every
    one of these is a plain 404 (and even the 404 carries headers)."""
    for path in ("/metrics", "/readyz", "/healthz",
                 "/docs", "/redoc", "/openapi.json"):
        r = web.get(path)
        assert r.status_code == 404, f"{path} -> {r.status_code} via web"
        _assert_headers(r, f"ops 404 {path}")


def test_backend_docs_gated_by_env(anon_api, web):
    """Under APP_ENV=prod FastAPI is built with docs_url=None — /docs and
    /openapi.json must 404 on the backend port itself. On the dev test
    stack they exist by design (and /api/auth/config advertises env)."""
    cfg = anon_api.get("/api/auth/config").json()
    if cfg["env"] == "prod":
        for path in ("/docs", "/redoc", "/openapi.json"):
            assert anon_api.get(path).status_code == 404, path
    else:
        assert cfg["env"] == "dev"
        assert anon_api.get("/openapi.json").status_code == 200
        pytest.skip("dev stack — docs served by design; prod gating is "
                    "config-level (contract/test_config_prod.py)")


def test_keycloak_proxy_sane_headers(web):
    """KC owns its own header policy on the proxied realm path — assert
    it's present (sniffing + framing protection), not that it's ours."""
    r = web.get("/realms/wds/.well-known/openid-configuration")
    assert r.status_code == 200
    assert r.headers.get("x-content-type-options") == "nosniff"
    frame = r.headers.get("x-frame-options") or \
        r.headers.get("content-security-policy", "")
    assert frame, "KC response carries no framing protection"
    # the login page (html) likewise
    r = web.get("/realms/wds/protocol/openid-connect/auth",
                params={"client_id": "wds-web",
                        "redirect_uri": "http://localhost:5173/auth/callback",
                        "response_type": "code", "scope": "openid"})
    # KC answers the auth endpoint with the login HTML (200) or a redirect
    # (302) depending on client/redirect-uri validation — either way its own
    # header policy must be on the response.
    assert r.status_code in (200, 302), r.status_code
    if r.status_code == 200:
        assert "text/html" in r.headers.get("content-type", "")
    assert r.headers.get("x-content-type-options") == "nosniff"


def test_no_server_version_banner(web):
    server = web.get("/").headers.get("server", "")
    assert "nginx" in server.lower()
    assert not re.search(r"nginx/[\d.]", server), \
        f"version banner leaked: {server!r}"


def test_unauthenticated_static_probe_leaks_nothing(web):
    """A random deep path must not disclose stack detail — SPA fallback
    serves index.html (no 5xx, no stack trace)."""
    r = web.get("/" + "x" * 50 + "/../../../etc/passwd")
    assert r.status_code in (200, 400, 404)
    assert "root:" not in r.text
