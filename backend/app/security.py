"""OIDC security (v4 T5, ADR-12) — the backend verifies, never issues.

Layers:

- ``JwksCache`` — bounded JWKS cache. Keys are used for ``JWKS_TTL_S``
  seconds; an unknown ``kid`` (key rollover) or a stale cache triggers one
  refetch, rate-limited to ``JWKS_REFETCH_MIN_S``. If the IdP is down there
  is no cached-forever path: verification fails closed -> 401.
- ``JwtVerifier`` — fixed ``RS256`` allowlist (the ``alg`` header is never
  consulted for verification, so HS256/none confusion is impossible),
  ``iss``/``aud``/``exp``/``iat``/``sub``/``sid`` checks, 30 s leeway.
- ``Security`` — token -> :class:`Principal` resolution: signature verify,
  ``revoked_sessions`` sid check (per-request PK lookup + NOTIFY fast path),
  ``users`` upsert on first sight, ``memberships`` org roles, ``disabled_at``.
  The authz record is cached ``AUTHZ_TTL_S`` (5 s) and invalidated
  immediately by Postgres ``NOTIFY wds_authz`` — the ≤5 s revocation SLA.
- Backchannel logout: ``verify_logout_token`` + ``record_logout`` writes
  ``revoked_sessions`` and NOTIFYs the channel.

Dev bearer tokens (``demo-operator`` …) resolve through ``auth.dev_principal``
only when ``APP_ENV=dev`` — in prod the branch doesn't exist.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
import urllib.request
from dataclasses import dataclass
from uuid import UUID

import jwt as pyjwt

from . import config
from .auth import Principal, dev_principal
from .db.context import global_tx, user_tx

log = logging.getLogger("backend.security")

#: RS256 only — never read alg from the token header (ADR-12 §5).
ALLOWED_ALGS = ("RS256",)
LEEWAY_S = 30.0
BACKCHANNEL_EVENT = "http://schemas.openid.net/event/backchannel-logout"
AUTHZ_CHANNEL = "wds_authz"


class AuthError(Exception):
    """Authentication failed -> REST 401 / WS close 4401."""

    def __init__(self, detail: str = "authentication required"):
        super().__init__(detail)
        self.detail = detail


class ForbiddenError(Exception):
    """Authenticated but not authorized -> REST 403 / WS close 4403."""

    def __init__(self, detail: str = "forbidden"):
        super().__init__(detail)
        self.detail = detail


# ---------------------------------------------------------------------------
# JWKS
# ---------------------------------------------------------------------------
class JwksCache:
    """Bounded JWKS cache — fail closed when the IdP is unreachable.

    Keys are served for ``ttl_s``. An unknown kid or an expired cache triggers
    a refetch, rate-limited so a flood of forged-kid tokens can't hammer the
    IdP. A failed refetch raises AuthError (401) — never serves stale keys.
    `fetcher` is injectable for unit tests.
    """

    def __init__(self, uri: str, ttl_s: float = 600.0,
                 refetch_min_s: float = 30.0, fetcher=None):
        self.uri = uri
        self.ttl_s = ttl_s
        self.refetch_min_s = refetch_min_s
        self._fetcher = fetcher or self._urllib_fetch
        self._keys: dict[str, pyjwt.PyJWK] = {}
        self._fetched_at = 0.0
        self._last_attempt = 0.0
        self._lock = asyncio.Lock()

    @staticmethod
    def _urllib_fetch(uri: str) -> dict:
        # stdlib client — no extra dependency for one JSON GET
        with urllib.request.urlopen(uri, timeout=5) as r:
            return json.loads(r.read())

    def _fresh(self) -> bool:
        return bool(self._keys) and (
            time.monotonic() - self._fetched_at) < self.ttl_s

    async def key_for(self, kid: str):
        if self._fresh() and kid in self._keys:
            return self._keys[kid]
        async with self._lock:
            if self._fresh() and kid in self._keys:
                return self._keys[kid]
            if time.monotonic() - self._last_attempt >= self.refetch_min_s:
                self._last_attempt = time.monotonic()
                try:
                    await self._refresh()
                except Exception as e:  # noqa: BLE001 — fail closed either way
                    log.warning("jwks fetch failed — failing closed",
                                extra={"err": str(e)})
            if self._fresh() and kid in self._keys:
                return self._keys[kid]
        raise AuthError("signing key unavailable")

    async def _refresh(self) -> None:
        jwks = await asyncio.to_thread(self._fetcher, self.uri)
        keys = {}
        for jwk in jwks.get("keys", []):
            # Realms serve more than signing keys (e.g. Keycloak's RSA-OAEP
            # enc key) — a single unusable entry must not poison the refresh.
            if (jwk.get("kty") != "RSA" or not jwk.get("kid")
                    or jwk.get("use", "sig") != "sig"):
                continue
            try:
                keys[jwk["kid"]] = pyjwt.PyJWK(jwk)
            except pyjwt.PyJWKError:
                log.info("jwks: skipping unusable key",
                         extra={"kid": jwk.get("kid")})
        if keys:
            self._keys = keys
            self._fetched_at = time.monotonic()
            log.info("jwks refreshed", extra={"keys": len(keys)})
        else:
            log.warning("jwks fetch returned no RSA signing keys")


class JwtVerifier:
    """RS256 JWT verifier pinned to one issuer + audience."""

    def __init__(self, issuer: str, audience: str, jwks: JwksCache):
        self.issuer = issuer
        self.audience = audience
        self.jwks = jwks

    async def verify(self, token: str, *, audience: str | None = None,
                     require: tuple[str, ...] = ("exp", "iat", "iss", "aud", "sub"),
                     require_sid: bool = True) -> dict:
        try:
            header = pyjwt.get_unverified_header(token)
        except pyjwt.PyJWTError as e:
            raise AuthError("malformed token") from e
        kid = header.get("kid")
        if not isinstance(kid, str) or not kid:
            raise AuthError("token lacks kid")
        key = await self.jwks.key_for(kid)
        try:
            claims = pyjwt.decode(
                token, key.key,
                algorithms=list(ALLOWED_ALGS),   # header alg is never trusted
                audience=audience or self.audience,
                issuer=self.issuer,
                leeway=LEEWAY_S,
                options={"require": list(require)},
            )
        except pyjwt.PyJWTError as e:
            raise AuthError("token rejected") from e
        if require_sid and not claims.get("sid"):
            raise AuthError("token lacks sid")
        return claims


# ---------------------------------------------------------------------------
# Authorization record (users + memberships)
# ---------------------------------------------------------------------------
@dataclass
class _AuthzRec:
    at: float
    user_id: UUID
    disabled: bool
    org_roles: dict[UUID, str]


class Security:
    """Token -> Principal, authz cache, revocation handling, WS eviction."""

    def __init__(self, pools, ws=None):
        self.pools = pools
        self.verifier = JwtVerifier(
            config.OIDC_ISSUER, config.OIDC_AUDIENCE,
            JwksCache(config.OIDC_JWKS_URI, ttl_s=config.JWKS_TTL_S,
                      refetch_min_s=config.JWKS_REFETCH_MIN_S))
        self._authz: dict[str, _AuthzRec] = {}
        # unbounded in the worst case (IdP logouts for unique sessions) —
        # TODO(T8): bound/evict with metrics when the hardening task lands
        self._revoked_sids: set[str] = set()
        self._authz_lock = asyncio.Lock()
        self._ws = ws  # WSManager, for NOTIFY-driven eviction

    # ------------------------------------------------------------- authenticate
    async def authenticate(self, token: str | None) -> Principal:
        """Bearer token -> Principal. Raises AuthError (401)."""
        if token:
            if config.APP_ENV == "dev":
                # Dev-token path exists ONLY in dev (ADR-12 §10); a dev token
                # that doesn't match falls through to JWT verification — a
                # garbage token is still 401, not anonymous.
                p = dev_principal(token)
                if p is not None:
                    return p
            claims = await self.verifier.verify(token)
            return await self._authorize(claims)
        raise AuthError()

    async def _authorize(self, claims: dict) -> Principal:
        sub, sid = claims["sub"], claims["sid"]
        if await self._is_revoked(sid):
            raise AuthError("session revoked")
        rec = await self._authz_rec(sub, claims)
        if rec.disabled:
            raise AuthError("user disabled")
        role = rec.org_roles.get(config.V1_ORG_ID, Principal.ROLE_NONE)
        return Principal(
            user=sub, role=role, kind="oidc", sub=sub, sid=sid,
            user_id=rec.user_id,
            org_roles=tuple(rec.org_roles.items()),
            exp=float(claims.get("exp", 0) or 0))

    async def _is_revoked(self, sid: str) -> bool:
        if not sid:
            return False
        if sid in self._revoked_sids:
            return True
        try:
            async with global_tx(self.pools.app) as conn:
                exists = await conn.fetchval(
                    "SELECT EXISTS(SELECT 1 FROM revoked_sessions WHERE sid=$1)", sid)
        except Exception:  # noqa: BLE001 — DB down must not open the gate
            log.exception("revoked_sessions check failed — failing closed")
            raise AuthError("authorization store unavailable") from None
        if exists:
            self._revoked_sids.add(sid)
        return bool(exists)

    async def _authz_rec(self, sub: str, claims: dict) -> _AuthzRec:
        rec = self._authz.get(sub)
        if rec and time.monotonic() - rec.at < config.AUTHZ_TTL_S:
            return rec
        async with self._authz_lock:
            rec = self._authz.get(sub)
            if rec and time.monotonic() - rec.at < config.AUTHZ_TTL_S:
                return rec
            rec = await self._load_authz(sub, claims)
            self._authz[sub] = rec
            return rec

    async def _load_authz(self, sub: str, claims: dict | None) -> _AuthzRec:
        try:
            async with global_tx(self.pools.app) as conn:
                if claims is not None:
                    # First-sight provisioning (ADR-12 §6): upsert the user row
                    # from the verified token claims.
                    row = await conn.fetchrow(
                        "INSERT INTO users(sub, email, email_verified, display_name)"
                        " VALUES ($1,$2,$3,$4)"
                        " ON CONFLICT (sub) DO UPDATE SET"
                        "  email=excluded.email,"
                        "  email_verified=users.email_verified OR excluded.email_verified,"
                        "  display_name=excluded.display_name"
                        " RETURNING id, disabled_at",
                        sub, claims.get("email"),
                        bool(claims.get("email_verified")),
                        claims.get("name") or claims.get("preferred_username") or sub)
                else:
                    row = await conn.fetchrow(
                        "SELECT id, disabled_at FROM users WHERE sub=$1", sub)
        except Exception:  # noqa: BLE001
            log.exception("user lookup failed — failing closed")
            raise AuthError("authorization store unavailable") from None
        if row is None:
            return _AuthzRec(time.monotonic(), UUID(int=0), False, {})
        uid = row["id"]
        disabled = row["disabled_at"] is not None
        org_roles: dict[UUID, str] = {}
        if not disabled:
            try:
                async with user_tx(self.pools.app, uid) as conn:
                    rows = await conn.fetch("SELECT org_id, role FROM memberships")
                org_roles = {r["org_id"]: r["role"] for r in rows}
            except Exception:  # noqa: BLE001
                log.exception("membership lookup failed — failing closed")
                raise AuthError("authorization store unavailable") from None
        return _AuthzRec(time.monotonic(), uid, disabled, org_roles)

    # ----------------------------------------------------- backchannel logout
    async def verify_logout_token(self, token: str) -> dict:
        """OIDC back-channel logout_token (ADR-12 §7): RS256, iss, aud=wds-web,
        the backchannel event in `events`, NO nonce (spec: a logout token with
        a nonce must be rejected), sid or sub to revoke."""
        claims = await self.verifier.verify(
            token, audience=config.OIDC_CLIENT_ID,
            require=("iss", "aud", "sub", "events"), require_sid=False)
        events = claims.get("events") or {}
        if BACKCHANNEL_EVENT not in events:
            raise AuthError("not a backchannel logout token")
        if "nonce" in claims:
            raise AuthError("logout token must not carry a nonce")
        if not claims.get("sid") and not claims.get("sub"):
            raise AuthError("logout token lacks sid/sub")
        return claims

    async def record_logout(self, claims: dict) -> None:
        """Write revoked_sessions + NOTIFY, then handle locally right away
        (don't wait for the listener round-trip).

        NOTE(deferred F4): KC's logout_token always carries `sid`; a
        sub-only token (no sid) would evict ALL of the user's sessions via
        the sub fallback in _handle_ws_event — accepted until T12's
        security suite re-examines it."""
        sid, sub = claims.get("sid"), claims.get("sub")
        async with global_tx(self.pools.app) as conn:
            if sid:
                await conn.execute(
                    "INSERT INTO revoked_sessions(sid) VALUES ($1)"
                    " ON CONFLICT (sid) DO NOTHING", sid)
            await conn.execute(
                "SELECT pg_notify($1, $2)", AUTHZ_CHANNEL,
                json.dumps({"type": "session_revoked", "sid": sid, "sub": sub}))
        self.on_notify(json.dumps(
            {"type": "session_revoked", "sid": sid, "sub": sub}))

    # --------------------------------------------------------- NOTIFY handling
    def _notify_cb(self, _conn, _pid, _channel, payload: str) -> None:
        self.on_notify(payload)

    def on_notify(self, payload: str) -> None:
        """wds_authz channel callback — runs on the event loop via asyncpg."""
        try:
            evt = json.loads(payload)
        except (json.JSONDecodeError, TypeError):
            log.warning("wds_authz: unparseable payload — clearing authz cache")
            self._authz.clear()
            return
        if not isinstance(evt, dict):
            return
        etype = evt.get("type")
        sid, sub = evt.get("sid"), evt.get("sub")
        if sid:
            self._revoked_sids.add(sid)
        if sub:
            self._authz.pop(sub, None)
        else:
            # unknown scope — fail closed, flush everything
            self._authz.clear()
        asyncio.ensure_future(self._handle_ws_event(etype, sid, sub))

    async def _handle_ws_event(self, etype, sid, sub) -> None:
        if self._ws is None:
            return
        for client in self._ws.clients():
            close = None
            if sid:
                # sid present (backchannel logout always carries it) — evict
                # ONLY that session; a sid+sub event must not kill the
                # user's other live sessions
                if client.sid == sid:
                    close = 4401  # session revoked
            elif sub and client.sub == sub:
                if etype in ("session_revoked", "user_disabled"):
                    close = 4401
                elif etype == "membership_changed":
                    # re-resolve: lost membership -> 4403; disabled -> 4401;
                    # role change is applied in place
                    try:
                        rec = await self._load_authz(sub, claims=None)
                    except AuthError:
                        close = 4401
                    else:
                        if rec.disabled:
                            close = 4401
                        else:
                            role = rec.org_roles.get(config.V1_ORG_ID,
                                                     Principal.ROLE_NONE)
                            if role == Principal.ROLE_NONE:
                                close = 4403
                            else:
                                self._authz[sub] = rec
                                client.role = role
            if close is not None:
                log.info("ws evicted by wds_authz", extra={"code": close})
                with contextlib.suppress(Exception):
                    await client.ws.close(code=close)


async def authz_listener(security: Security) -> None:
    """Hold a dedicated LISTEN connection on the system pool; NOTIFY delivery
    drives on_notify. Reconnects forever on failure — the 5 s authz-cache TTL
    bounds staleness even while the listener is down."""
    while True:
        conn = None
        try:
            conn = await security.pools.system.acquire()
            await conn.add_listener(AUTHZ_CHANNEL, security._notify_cb)
            log.info("wds_authz listener connected")
            while not conn.is_closed():
                await asyncio.sleep(30)
            raise ConnectionError("listener connection closed")
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            log.exception("wds_authz listener down — retrying in 5s")
            await asyncio.sleep(5)
        finally:
            if conn is not None:
                with contextlib.suppress(Exception):
                    await security.pools.system.release(conn)
