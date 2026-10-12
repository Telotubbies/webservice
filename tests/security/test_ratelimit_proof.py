"""Rate-limit proof — 429 + Retry-After observed live (v4 T13).

Mechanized version of the OWASP API4 (unrestricted resource consumption)
check. Buckets burned:

- POST /api/commands  — per user+tag, RATE_COMMANDS_PER_TAG/window
  (doc 16 row 7). Burns on the read-only `speed_mps` tag as
  demo-operator — a bucket unused by any other suite, exercising the
  command path through the NORMAL lifecycle (issue -> denied by edge;
  no edge-facing fuzzing, per the ICS safety boundary).
- Mutations (alarm ack on a 404 id) — per user, RATE_MUTATIONS_PER_USER.
- POST /api/auth/backchannel-logout — per client IP, unauthenticated —
  each forged logout token burns a JWKS verify, so this is the tightest
  bucket in the app.

Tests probe until the configured limit (env RATE_* pass-through, same
as the stack) so any bucket size proves itself.
"""

from __future__ import annotations

import os
import time
import uuid

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.security]

from conftest import OPERATOR_TOKEN, TAGS, wait_until  # noqa: E402

CMD_LIMIT = int(os.environ.get("RATE_COMMANDS_PER_TAG", "5"))
CMD_WINDOW = float(os.environ.get("RATE_COMMANDS_WINDOW_S", "10"))
MUT_LIMIT = int(os.environ.get("RATE_MUTATIONS_PER_USER", "60"))
LOGOUT_LIMIT = int(os.environ.get("RATE_LOGOUT_PER_IP", "10"))

BURN_TAG = TAGS["speed_mps"]   # read-only; isolated user+tag bucket
TERMINAL = ("done", "denied", "failed", "timeout")


@pytest.fixture()
def op_headers():
    return {"Authorization": f"Bearer {OPERATOR_TOKEN}"}


def _wait_terminal(api, cid, headers, timeout_s=20):
    def poll():
        r = api.get(f"/api/commands/{cid}", headers=headers)
        if r.status_code != 200:
            return None
        b = r.json()
        return b if b.get("status") in TERMINAL else None
    return wait_until(poll, timeout_s, desc=f"command {cid} terminal")


def test_command_bucket_429_retry_after(api, op_headers):
    """Commands past RATE_COMMANDS_PER_TAG in-window -> 429 with a usable
    Retry-After; the bucket recovers and accepts again afterwards."""
    hit, accepted = None, 0
    for _ in range(CMD_LIMIT * 4 + 2):
        r = api.post("/api/commands", headers=op_headers,
                     json={"tag": BURN_TAG, "value": 1.0, "ttl_s": 15,
                           "idempotency_key": f"sec-rl-{uuid.uuid4()}"})
        if r.status_code == 429:
            hit = r
            break
        assert r.status_code == 201, (r.status_code, r.text[:200])
        accepted += 1
        _wait_terminal(api, r.json()["command_id"], op_headers)
    assert hit is not None, "no 429 — command limiter not engaged"
    assert accepted >= CMD_LIMIT, \
        f"only {accepted} commands burned before 429 (limit {CMD_LIMIT})"
    ra = hit.headers.get("retry-after")
    assert ra is not None and int(ra) >= 1, dict(hit.headers)
    assert hit.json().get("detail") == "rate_limited"
    # recovery: Retry-After is honest — a legit command lands after it
    time.sleep(min(int(ra) + 1, int(CMD_WINDOW) + 2))
    r = api.post("/api/commands", headers=op_headers,
                 json={"tag": BURN_TAG, "value": 1.0, "ttl_s": 15,
                       "idempotency_key": f"sec-rl2-{uuid.uuid4()}"})
    assert r.status_code == 201, (r.status_code, r.text[:200])
    _wait_terminal(api, r.json()["command_id"], op_headers)


def test_mutation_bucket_429_retry_after(api, op_headers):
    """Non-command mutations count against the per-user bucket — even a
    404 ack spends (the gate precedes the lookup)."""
    fake = uuid.uuid4()
    codes, hit = [], None
    for _ in range(MUT_LIMIT + 8):
        r = api.post(f"/api/alarms/{fake}/ack", headers=op_headers)
        if r.status_code == 429:
            hit = r
            break
        codes.append(r.status_code)
    assert hit is not None, f"no 429 after {MUT_LIMIT + 8} acks: {codes}"
    assert set(codes) <= {404}, codes
    ra = hit.headers.get("retry-after")
    assert ra is not None and int(ra) >= 1
    assert hit.json().get("detail") == "rate_limited"
    # leave the bucket recovering — don't strand the next suite drained
    time.sleep(min(int(ra) + 3, 30))


def test_backchannel_logout_per_ip_limit(anon_api):
    """The unauthenticated JWKS-verified logout endpoint is the cheapest
    forgery target in the app — it must be per-IP limited."""
    hit, codes = None, []
    for _ in range(LOGOUT_LIMIT + 6):
        r = anon_api.post("/api/auth/backchannel-logout",
                          data={"logout_token": "garbage"})
        if r.status_code == 429:
            hit = r
            break
        codes.append(r.status_code)
    assert hit is not None, f"no 429 after {LOGOUT_LIMIT + 6} posts: {codes}"
    assert set(codes) <= {401}, codes
    assert hit.headers.get("retry-after") is not None
