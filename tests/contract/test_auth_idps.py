"""GET /api/auth/config `idps` contract: ["google"] only when BOTH Google
credentials are configured (Keycloak-brokered sign-in), [] otherwise."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[2] / "backend"


def _idps(extra: dict) -> str:
    env = {k: v for k, v in os.environ.items() if not k.startswith("GOOGLE_")}
    env.update(extra, PYTHONPATH=str(BACKEND), APP_ENV="dev")
    r = subprocess.run([sys.executable, "-c", "import app.config as c; print(c.IDPS)"],
                       env=env, capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    return r.stdout.strip()


@pytest.mark.parametrize("extra,expected", [
    ({}, "[]"),
    ({"GOOGLE_CLIENT_ID": "id"}, "[]"),
    ({"GOOGLE_CLIENT_ID": "id", "GOOGLE_CLIENT_SECRET": " "}, "[]"),
    ({"GOOGLE_CLIENT_ID": "id", "GOOGLE_CLIENT_SECRET": "s"}, "['google']"),
])
def test_idps_follow_google_credentials(extra, expected):
    assert _idps(extra) == expected


def test_web_client_gains_public_origin_idempotently():
    code = (
        "from app.provision_idp import web_client_with_origin as f;"
        "rep={'redirectUris':['http://localhost:5173/*'],'webOrigins':['http://localhost:5173'],"
        "'attributes':{'post.logout.redirect.uris':'http://localhost:5173/*'}};"
        "a=f(rep,'https://ops.example.com/'); b=f(a,'https://ops.example.com');"
        "assert a==b;"
        "assert 'https://ops.example.com/*' in a['redirectUris'] and 'http://localhost:5173/*' in a['redirectUris'];"
        "assert 'https://ops.example.com' in a['webOrigins'];"
        "assert 'https://ops.example.com/*' in a['attributes']['post.logout.redirect.uris'].split('##');"
        "print('ok')"
    )
    env = dict(os.environ, PYTHONPATH=str(BACKEND), APP_ENV="dev")
    r = subprocess.run([sys.executable, "-c", code], env=env, capture_output=True, text=True, timeout=30)
    assert r.returncode == 0 and r.stdout.strip() == "ok", r.stderr
