"""Offline unit tests for the API-key auth path (wds_sk_*).

No services needed: a fake asyncpg pool/connection is injected into
Security so the REAL key_tx context manager and set_key_user helper run —
only the row answers are stubbed. Every failure mode must raise AuthError
(fail closed); nothing may silently authenticate.

Covered: valid key -> apikey Principal, unknown/revoked/expired keys,
disabled or membership-less service users, authz-store outage, the
last_used_at write throttle, cross-org keys getting ROLE_NONE, and the
context.py key helpers' input validation.
"""

from __future__ import annotations

import asyncio
import hashlib
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest

from app.core import config
from app.db.context import key_tx, set_key_user
from app.iam.security import AuthError, Security

KEY = "wds_sk_" + "a1b2c3d4" * 5                    # 40-char key body
KEY_HASH = hashlib.sha256(KEY.encode()).hexdigest()
ORG = config.V1_ORG_ID
OTHER_ORG = uuid4()
UID = uuid4()


def run(coro):
    return asyncio.run(coro)


class _FakeTx:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class FakeConn:
    """asyncpg.Connection stand-in: fetchrow routes by table name, execute()
    records calls so tests can assert the set_config escalation and the
    last_used_at write happened (or didn't)."""

    def __init__(self, key_row=None, user_row=None, member_row=None,
                 fail: bool = False, rate: int = 120):
        self.key_row = key_row
        self.user_row = user_row
        self.member_row = member_row
        self.fail = fail
        self.rate = rate
        self.executed: list[tuple[str, tuple]] = []

    def transaction(self):
        return _FakeTx()

    async def fetchrow(self, sql: str, *args):
        if self.fail:
            raise ConnectionError("authz store down")
        if "FROM api_keys" in sql:
            return self.key_row
        if "FROM users" in sql:
            return self.user_row
        if "FROM memberships" in sql:
            return self.member_row
        raise AssertionError(f"unexpected fetchrow: {sql}")

    async def execute(self, sql: str, *args):
        if self.fail:
            raise ConnectionError("authz store down")
        self.executed.append((sql, args))
        return "OK"

    async def fetchval(self, sql: str, *args):
        if self.fail:
            raise ConnectionError("authz store down")
        if "FROM organizations" in sql:
            return self.rate
        raise AssertionError(f"unexpected fetchval: {sql}")


class FakePool:
    def __init__(self, conn: FakeConn):
        self._conn = conn

    def acquire(self):
        conn = self._conn

        class _Acquire:
            async def __aenter__(self):
                return conn

            async def __aexit__(self, *exc):
                return False

        return _Acquire()


def key_row(**kw):
    row = {"id": uuid4(), "org_id": ORG, "user_id": UID, "name": "ci-bot",
           "expires_at": None, "revoked_at": None, "last_used_at": None}
    row.update(kw)
    return row


def user_row(**kw):
    row = {"sub": "svc-ci-bot", "disabled_at": None}
    row.update(kw)
    return row


def member_row(role="operator"):
    return {"role": role}


def make_sec(conn: FakeConn) -> Security:
    return Security(pools=SimpleNamespace(app=FakePool(conn)))


def statements(conn: FakeConn, needle: str) -> list[tuple]:
    return [a for sql, a in conn.executed if needle in sql]


# --------------------------------------------------------------- happy path

def test_valid_key_resolves_apikey_principal():
    conn = FakeConn(key_row(), user_row(), member_row("operator"))
    p = run(make_sec(conn).authenticate(KEY))
    assert p.kind == "apikey"
    assert p.user == "ci-bot"
    assert p.sub == "svc-ci-bot"
    assert p.user_id == UID
    assert p.role == "operator" and p.member and p.can_operate
    assert p.org_roles == ((ORG, "operator"),)
    assert p.exp == 0.0                       # no expiry -> never expires


def test_expiry_mirrored_into_principal_exp():
    exp = datetime.now(timezone.utc) + timedelta(days=30)
    conn = FakeConn(key_row(expires_at=exp), user_row(), member_row())
    p = run(make_sec(conn).authenticate(KEY))
    assert p.exp == pytest.approx(exp.timestamp())


def test_lookup_escalates_context_to_key_owner():
    """key_tx sets app.key_hash; set_key_user must add app.user_id so the
    users/memberships reads pass RLS — both writes happen on the conn."""
    conn = FakeConn(key_row(), user_row(), member_row())
    run(make_sec(conn).authenticate(KEY))
    assert statements(conn, "'app.key_hash'") == [(KEY_HASH,)]
    assert statements(conn, "'app.user_id'") == [(str(UID),)]


# ------------------------------------------------------------ must-fail 401

def test_unknown_key_rejected():
    conn = FakeConn(None, user_row(), member_row())
    with pytest.raises(AuthError):
        run(make_sec(conn).authenticate(KEY))


def test_revoked_key_rejected():
    conn = FakeConn(key_row(revoked_at=datetime.now(timezone.utc)),
                    user_row(), member_row())
    with pytest.raises(AuthError):
        run(make_sec(conn).authenticate(KEY))


def test_expired_key_rejected():
    conn = FakeConn(key_row(expires_at=datetime.now(timezone.utc)
                            - timedelta(seconds=1)),
                    user_row(), member_row())
    with pytest.raises(AuthError):
        run(make_sec(conn).authenticate(KEY))


def test_disabled_service_user_rejected():
    conn = FakeConn(key_row(),
                    user_row(disabled_at=datetime.now(timezone.utc)),
                    member_row())
    with pytest.raises(AuthError):
        run(make_sec(conn).authenticate(KEY))


def test_missing_membership_rejected():
    conn = FakeConn(key_row(), user_row(), None)
    with pytest.raises(AuthError):
        run(make_sec(conn).authenticate(KEY))


def test_authz_store_down_fails_closed():
    """A DB outage must not open the gate — broad except -> AuthError."""
    conn = FakeConn(fail=True)
    with pytest.raises(AuthError):
        run(make_sec(conn).authenticate(KEY))


# ------------------------------------------------------ cross-org isolation

def test_key_for_other_org_authenticates_but_role_none():
    """A key whose membership lives in another org resolves (org_roles carry
    it) but has ROLE_NONE in the v1 shim org — authenticated, not a member."""
    conn = FakeConn(key_row(org_id=OTHER_ORG), user_row(), member_row("admin"))
    p = run(make_sec(conn).authenticate(KEY))
    assert p.kind == "apikey" and p.authenticated
    assert p.role == "none" and not p.member and not p.can_operate
    assert p.org_roles == ((OTHER_ORG, "admin"),)


# ------------------------------------------------------- last_used throttle

def test_last_used_written_when_stale():
    stale = datetime.now(timezone.utc) - timedelta(seconds=120)
    conn = FakeConn(key_row(last_used_at=stale), user_row(), member_row())
    run(make_sec(conn).authenticate(KEY))
    assert statements(conn, "UPDATE api_keys SET last_used_at")


def test_last_used_written_when_never_used():
    conn = FakeConn(key_row(last_used_at=None), user_row(), member_row())
    run(make_sec(conn).authenticate(KEY))
    assert statements(conn, "UPDATE api_keys SET last_used_at")


def test_last_used_skipped_when_recent():
    fresh = datetime.now(timezone.utc) - timedelta(seconds=30)
    conn = FakeConn(key_row(last_used_at=fresh), user_row(), member_row())
    run(make_sec(conn).authenticate(KEY))
    assert not statements(conn, "UPDATE api_keys SET last_used_at")


# ------------------------------------------------------ context.py helpers

def test_key_tx_rejects_malformed_hash():
    pool = FakePool(FakeConn())
    with pytest.raises(ValueError):
        run(_enter(key_tx(pool, "not-a-hash")))


def test_set_key_user_rejects_non_uuid():
    conn = FakeConn()
    with pytest.raises(TypeError):
        run(set_key_user(conn, "0199d000-0000-7000-8000-00000000d001"))


def test_set_key_user_writes_user_id():
    conn = FakeConn()
    run(set_key_user(conn, UID))
    assert statements(conn, "'app.user_id'") == [(str(UID),)]


async def _enter(cm):
    async with cm:
        return None
