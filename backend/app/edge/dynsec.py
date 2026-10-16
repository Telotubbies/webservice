"""Dynamic-security admin channel + reconciler (doc 17, BINDING).

`svc-dynsec-admin` is the ONLY identity allowed on
`$CONTROL/dynamic-security/#`. This module owns two pieces:

* ``DynsecAdmin`` — a paho MQTTv5 request/response client for the dynsec
  command protocol. The provisioning API uses it synchronously
  (create/rotate/disable); the reconciler uses it for the DB→broker sync.
* ``Reconciler`` — one-way sync Postgres → broker (doc 17 §6). Desired
  state lives in `edges` + `edge_identities`; the dynsec JSON is a cache.
  Runs at startup, every ``DYNSEC_RECONCILE_S``, and on ``NOTIFY wds_edges``.
  It never re-enables a client the DB marks disabled, and it deletes nothing
  silently — unknown ``edge-*`` clients are disabled and counted as
  ``mqtt.orphan_client``.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import logging
import os
import secrets
import uuid
from datetime import datetime, timezone
from pathlib import Path

import paho.mqtt.client as mqtt
from paho.mqtt.packettypes import PacketTypes
from paho.mqtt.properties import Properties

log = logging.getLogger("backend.dynsec")

CTRL_TOPIC = "$CONTROL/dynamic-security/v1"
RESP_TOPIC = "$CONTROL/dynamic-security/v1/response"
NOTIFY_CHANNEL = "wds_edges"

REQUEST_TIMEOUT_S = 8.0


class DynsecError(Exception):
    """A dynsec command returned an error response or timed out."""


def fingerprint(secret: str) -> str:
    """sha256 hex — the only thing the DB ever stores of a secret (doc 17 §5)."""
    return hashlib.sha256(secret.encode()).hexdigest()


def new_secret() -> str:
    return secrets.token_urlsafe(32)


def edge_client_name(edge_id: uuid.UUID, version: int) -> str:
    return f"edge-{edge_id}-v{version}"


def edge_role_name(edge_id: uuid.UUID) -> str:
    return f"edge-{edge_id}"


def edge_prefix(org_id, site_id, edge_id) -> str:
    return f"v2/{org_id}/{site_id}/{edge_id}"


def edge_acls(org_id, site_id, edge_id) -> list[dict]:
    """Doc 17 §3 edge role — least privilege, default deny everywhere else."""
    p = edge_prefix(org_id, site_id, edge_id)
    return [
        {"acltype": "publishClientSend", "topic": f"{p}/tele/#", "allow": True},
        {"acltype": "publishClientSend", "topic": f"{p}/hb", "allow": True},
        {"acltype": "publishClientSend", "topic": f"{p}/cmd-resp/+", "allow": True},
        {"acltype": "subscribePattern", "topic": f"{p}/cmd/+", "allow": True},
        {"acltype": "publishClientReceive", "topic": f"{p}/cmd/+", "allow": True},
        # spec 5.4 config delivery
        {"acltype": "subscribePattern", "topic": f"{p}/cfg", "allow": True},
        {"acltype": "publishClientReceive", "topic": f"{p}/cfg", "allow": True},
        {"acltype": "publishClientSend", "topic": f"{p}/cfg-req", "allow": True},
        {"acltype": "publishClientSend", "topic": f"{p}/cfg-ack", "allow": True},
        # plan M1-03: camera frames and health
        {"acltype": "publishClientSend", "topic": f"{p}/vision/frame/+", "allow": True},
        {"acltype": "publishClientSend", "topic": f"{p}/vision/stat", "allow": True},
        # plan M1-05: gateway capabilities report (exact topic, nothing under it)
        {"acltype": "publishClientSend", "topic": f"{p}/vision/caps", "allow": True},
        # roadmap 9.7/9.8: rule events, signed write audits, per-minute counts
        {"acltype": "publishClientSend", "topic": f"{p}/vision/event", "allow": True},
        {"acltype": "publishClientSend", "topic": f"{p}/vision/audit", "allow": True},
        {"acltype": "publishClientSend", "topic": f"{p}/vision/count", "allow": True},
        # edge log shipper
        {"acltype": "publishClientSend", "topic": f"{p}/logs", "allow": True},
        # in-band credential rotation for enrolled gateways (backend -> edge)
        {"acltype": "subscribePattern", "topic": f"{p}/cred", "allow": True},
        {"acltype": "publishClientReceive", "topic": f"{p}/cred", "allow": True},
    ]


# doc 17 §3 — backend may subscribe the whole v2 telemetry tree (fan-out +
# shared ingest group) and publish commands; $CONTROL stays default-denied.
BACKEND_ACLS = [
    {"acltype": "publishClientSend", "topic": "v2/+/+/+/cmd/+", "allow": True},
    {"acltype": "publishClientSend", "topic": "v2/+/+/+/cfg", "allow": True},
    {"acltype": "publishClientSend", "topic": "v2/+/+/+/cred", "allow": True},
    {"acltype": "subscribePattern", "topic": "v2/+/+/+/tele/#", "allow": True},
    {"acltype": "subscribePattern", "topic": "v2/+/+/+/hb", "allow": True},
    {"acltype": "subscribePattern", "topic": "$share/ingest/v2/+/+/+/tele/#", "allow": True},
    {"acltype": "subscribePattern", "topic": "$share/ingest/v2/+/+/+/hb", "allow": True},
    {"acltype": "subscribePattern", "topic": "$share/ingest/v2/+/+/+/cmd-resp/+", "allow": True},
    {"acltype": "publishClientReceive", "topic": "v2/+/+/+/tele/#", "allow": True},
    {"acltype": "publishClientReceive", "topic": "v2/+/+/+/hb", "allow": True},
    {"acltype": "publishClientReceive", "topic": "v2/+/+/+/cmd-resp/+", "allow": True},
    {"acltype": "subscribePattern", "topic": "$share/ingest/v2/+/+/+/cfg-req", "allow": True},
    {"acltype": "subscribePattern", "topic": "$share/ingest/v2/+/+/+/cfg-ack", "allow": True},
    {"acltype": "publishClientReceive", "topic": "v2/+/+/+/cfg-req", "allow": True},
    {"acltype": "publishClientReceive", "topic": "v2/+/+/+/cfg-ack", "allow": True},
    {"acltype": "subscribePattern", "topic": "$share/ingest/v2/+/+/+/vision/frame/+", "allow": True},
    {"acltype": "subscribePattern", "topic": "$share/ingest/v2/+/+/+/vision/stat", "allow": True},
    {"acltype": "subscribePattern", "topic": "$share/ingest/v2/+/+/+/vision/caps", "allow": True},
    {"acltype": "publishClientReceive", "topic": "v2/+/+/+/vision/frame/+", "allow": True},
    {"acltype": "publishClientReceive", "topic": "v2/+/+/+/vision/stat", "allow": True},
    {"acltype": "publishClientReceive", "topic": "v2/+/+/+/vision/caps", "allow": True},
    # roadmap 9.7/9.8 vision rule/event channels + log shipper
    {"acltype": "subscribePattern", "topic": "$share/ingest/v2/+/+/+/vision/event", "allow": True},
    {"acltype": "subscribePattern", "topic": "$share/ingest/v2/+/+/+/vision/audit", "allow": True},
    {"acltype": "subscribePattern", "topic": "$share/ingest/v2/+/+/+/vision/count", "allow": True},
    {"acltype": "subscribePattern", "topic": "$share/ingest/v2/+/+/+/logs", "allow": True},
    {"acltype": "publishClientReceive", "topic": "v2/+/+/+/vision/event", "allow": True},
    {"acltype": "publishClientReceive", "topic": "v2/+/+/+/vision/audit", "allow": True},
    {"acltype": "publishClientReceive", "topic": "v2/+/+/+/vision/count", "allow": True},
    {"acltype": "publishClientReceive", "topic": "v2/+/+/+/logs", "allow": True},
]

# doc 17 §2 — svc-dynsec-admin is the ONLY $CONTROL identity. The
# `mosquitto_ctrl dynsec init` bootstrap role is deliberately broad (# —
# it is a recovery ladder); the reconciler converges it to least privilege.
ADMIN_ACLS = [
    {"acltype": "publishClientSend", "topic": "$CONTROL/dynamic-security/#",
     "allow": True},
    {"acltype": "publishClientReceive", "topic": "$CONTROL/dynamic-security/#",
     "allow": True},
    {"acltype": "subscribePattern", "topic": "$CONTROL/dynamic-security/#",
     "allow": True},
]

# Fault-injection identity — TEST PROFILE ONLY. Wide inside v2 (it must be
# able to impersonate an edge, a backend and emit garbage on valid-shaped
# prefixes for the trust-rule tests), but still scoped: no $CONTROL, no $SYS,
# nothing outside v2.
TESTER_ACLS = [
    {"acltype": "publishClientSend", "topic": "v2/#", "allow": True},
    {"acltype": "publishClientReceive", "topic": "v2/#", "allow": True},
    {"acltype": "subscribePattern", "topic": "v2/#", "allow": True},
]


class DynsecAdmin:
    """Single-flight request/response wrapper over the dynsec control topic.

    paho runs its own network thread; responses are correlated to asyncio
    futures via the MQTTv5 CorrelationData property.
    """

    def __init__(self, host: str, port: int, username: str, password: str,
                 ca_file: str | None = None):
        self.host, self.port = host, port
        self.connected = False
        self._loop: asyncio.AbstractEventLoop | None = None
        self._lock = asyncio.Lock()
        self._pending: dict[bytes, asyncio.Future] = {}
        self.client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=f"svc-dynsec-admin-{uuid.uuid4().hex[:6]}",
            protocol=mqtt.MQTTv5,
        )
        self.client.username_pw_set(username, password)
        if ca_file:
            self.client.tls_set(ca_certs=ca_file)
        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_message = self._on_message
        self.client.reconnect_delay_set(min_delay=1, max_delay=15)

    # -- lifecycle -----------------------------------------------------------
    def start(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop
        try:
            self.client.connect_async(self.host, self.port, keepalive=30)
            self.client.loop_start()
        except OSError as exc:
            log.error("dynsec connect_async failed: %s", exc)

    def stop(self) -> None:
        try:
            self.client.loop_stop()
            self.client.disconnect()
        except Exception:  # noqa: BLE001
            pass

    # -- paho callbacks (network thread) --------------------------------------
    def _on_connect(self, client, userdata, flags, reason_code, properties):
        self.connected = not reason_code.is_failure
        if self.connected:
            client.subscribe(RESP_TOPIC, qos=1)
            log.info("dynsec admin connected")
        else:
            log.warning("dynsec admin connack refused rc=%s", reason_code)

    def _on_disconnect(self, client, userdata, flags, reason_code, properties):
        if self.connected:
            log.warning("dynsec admin disconnected rc=%s", reason_code)
        self.connected = False

    def _on_message(self, client, userdata, msg):
        corr = None
        props = getattr(msg, "properties", None)
        if props is not None:
            corr = getattr(props, "CorrelationData", None)
        if self._loop is None:
            return
        self._loop.call_soon_threadsafe(self._deliver, corr, msg.payload)

    def _deliver(self, corr, payload: bytes) -> None:
        key = corr if corr in self._pending else None
        if key is None and len(self._pending) == 1:
            # mosquitto does NOT echo CorrelationData on dynsec responses —
            # with single-flight (the call lock) the lone outstanding request
            # is the only possible attribution.
            key = next(iter(self._pending))
        if key is None:
            return
        fut, expected = self._pending[key]
        if fut.done():
            return
        try:
            body = json.loads(payload)
        except Exception as exc:  # noqa: BLE001
            self._pending.pop(key, None)
            fut.set_exception(exc)
            return
        got = [r.get("command") for r in body.get("responses", [])]
        if got != expected:
            # A late response from a previously timed-out call must not be
            # misattributed to the in-flight request — drop it and let the
            # real response arrive (or the request time out honestly).
            log.warning("dynsec stale response ignored",
                        extra={"expected": expected, "got": got})
            return
        self._pending.pop(key, None)
        fut.set_result(body)

    # -- command protocol ------------------------------------------------------
    async def call(self, *commands: dict, timeout: float = REQUEST_TIMEOUT_S) -> list[dict]:
        """Publish one dynsec request; return the per-command response list.
        Raises DynsecError on timeout/transport failure — NOT on per-command
        ``error`` fields (callers decide if e.g. 'Client already exists' is
        benign for their flow)."""
        if self._loop is None:
            raise DynsecError("dynsec admin not started")
        async with self._lock:
            corr = os.urandom(16)
            fut = self._loop.create_future()
            self._pending[corr] = (fut, [c.get("command") for c in commands])
            props = Properties(PacketTypes.PUBLISH)
            props.ResponseTopic = RESP_TOPIC
            props.CorrelationData = corr
            try:
                info = self.client.publish(
                    CTRL_TOPIC,
                    json.dumps({"commands": list(commands)}),
                    qos=1, properties=props)
                if info.rc != mqtt.MQTT_ERR_SUCCESS:
                    raise DynsecError(f"dynsec publish rc={info.rc}")
                try:
                    body = await asyncio.wait_for(fut, timeout)
                except asyncio.TimeoutError as exc:
                    raise DynsecError("dynsec request timed out") from exc
            finally:
                self._pending.pop(corr, None)
        return (body or {}).get("responses", [])

    # -- typed helpers ---------------------------------------------------------
    async def _one(self, command: dict) -> dict:
        res = await self.call(command)
        return res[0] if res else {"error": "empty dynsec response"}

    async def get_role(self, role: str) -> dict | None:
        r = await self._one({"command": "getRole", "rolename": role})
        if r.get("error"):
            return None
        return (r.get("data") or {}).get("role")

    async def ensure_role(self, role: str, acls: list[dict],
                          known_roles: set[str] | None = None) -> None:
        """Create the role if absent; if it already exists, repair ACL drift
        (doc 17 §6 — the broker is a cache; desired ACLs are authoritative)."""
        if known_roles is not None and role in known_roles:
            return await self._repair_role(role, acls)
        r = await self._one({"command": "createRole", "rolename": role})
        err = r.get("error", "")
        if err and "already exists" not in err:
            raise DynsecError(f"createRole {role}: {err}")
        cmds = [{"command": "addRoleACL", "rolename": role,
                 "acltype": a["acltype"], "topic": a["topic"], "allow": a["allow"]}
                for a in acls]
        for resp in await self.call(*cmds):
            err = resp.get("error", "")
            # re-applying an ACL set is idempotent — duplicates are a no-op
            if err and "already exists" not in err and "Duplicate" not in err:
                raise DynsecError(f"addRoleACL {role}: {err}")

    async def _repair_role(self, role: str, acls: list[dict]) -> None:
        """Diff desired ACLs against the broker's and converge — missing
        entries are added before stale ones are removed, so a repair mid-
        pass never leaves the role narrower than intended."""
        cur = await self.get_role(role)
        if cur is None:
            return await self.ensure_role(role, acls)
        have = {(a["acltype"], a["topic"], bool(a.get("allow", True)))
                for a in cur.get("acls", [])}
        want = {(a["acltype"], a["topic"], bool(a["allow"])) for a in acls}
        missing, extra = want - have, have - want
        if not missing and not extra:
            return
        for acltype, topic, allow in missing:
            r = await self._one({"command": "addRoleACL", "rolename": role,
                                 "acltype": acltype, "topic": topic,
                                 "allow": allow})
            if r.get("error"):
                raise DynsecError(f"addRoleACL {role}: {r['error']}")
        for acltype, topic, _allow in extra:
            r = await self._one({"command": "removeRoleACL", "rolename": role,
                                 "acltype": acltype, "topic": topic})
            err = r.get("error", "")
            if err and "not found" not in err.lower():
                raise DynsecError(f"removeRoleACL {role}: {err}")
        log.warning("mqtt.role_acl_drift repaired",
                    extra={"role": role,
                           "added": len(missing), "removed": len(extra)})

    async def create_client(self, username: str, password: str, role: str) -> None:
        """Create a dynsec client and attach it to `role`. 'Already exists'
        is healed by setClientPassword + addClientRole so a retry after a
        lost response lands deterministically (doc 17 §6)."""
        r = await self._one({"command": "createClient", "username": username,
                             "password": password, "textname": username})
        err = r.get("error", "")
        if err and "already exists" not in err:
            raise DynsecError(f"createClient {username}: {err}")
        if err:  # exists — force the password to the one we are issuing
            r2 = await self._one({"command": "setClientPassword",
                                  "username": username, "password": password})
            if r2.get("error"):
                raise DynsecError(f"setClientPassword {username}: {r2['error']}")
        r3 = await self._one({"command": "addClientRole",
                              "username": username, "rolename": role})
        err3 = r3.get("error", "")
        if err3 and "already exists" not in err3 and "Duplicate" not in err3:
            raise DynsecError(f"addClientRole {username}/{role}: {err3}")

    async def disable_client(self, username: str) -> bool:
        r = await self._one({"command": "disableClient", "username": username})
        err = r.get("error", "")
        if err:
            if "not found" in err.lower() or "does not exist" in err.lower():
                return False
            raise DynsecError(f"disableClient {username}: {err}")
        log.warning("dynsec client disabled", extra={"username": username})
        return True

    async def enable_client(self, username: str) -> None:
        r = await self._one({"command": "enableClient", "username": username})
        if r.get("error"):
            raise DynsecError(f"enableClient {username}: {r['error']}")

    async def get_client(self, username: str) -> dict | None:
        r = await self._one({"command": "getClient", "username": username,
                             "verbose": True})
        if r.get("error"):
            return None
        return (r.get("data") or {}).get("client")

    async def list_clients(self) -> dict[str, dict]:
        """username -> {disabled, connected} via a verbose listClients."""
        r = await self._one({"command": "listClients", "verbose": True, "count": -1})
        if r.get("error"):
            raise DynsecError(f"listClients: {r['error']}")
        out: dict[str, dict] = {}
        for c in (r.get("data") or {}).get("clients", []):
            out[c["username"]] = {
                "disabled": bool(c.get("disabled")),
                "connected": bool(c.get("connections")),
            }
        return out

    async def list_roles(self) -> set[str]:
        r = await self._one({"command": "listRoles", "verbose": False, "count": -1})
        if r.get("error"):
            raise DynsecError(f"listRoles: {r['error']}")
        # mosq returns bare names non-verbose, {rolename:...} verbose — tolerate both
        raw = (r.get("data") or {}).get("roles", []) or []
        return {x if isinstance(x, str) else x.get("rolename", "") for x in raw} - {""}


# ---------------------------------------------------------------------------
# Reconciler — Postgres is the source of truth; the broker is a cache (17 §6)
# ---------------------------------------------------------------------------
from ..db.context import global_tx, tenant_tx


def _read_secret_file(path: str | None) -> str | None:
    if not path:
        return None
    try:
        return Path(path).read_text().strip() or None
    except OSError:
        return None


class Reconciler:
    def __init__(self, pools, admin: DynsecAdmin, *,
                 reconcile_s: float = 60.0,
                 svc_backend_pw_file: str | None = None,
                 tester_pw_file: str | None = None,
                 edge_bootstrap_pw_file: str | None = None):
        self.pools = pools
        self.admin = admin
        self.reconcile_s = reconcile_s
        self.svc_backend_pw_file = svc_backend_pw_file
        self.tester_pw_file = tester_pw_file
        self.edge_bootstrap_pw_file = edge_bootstrap_pw_file
        self._wake = asyncio.Event()
        self.counters = {"mqtt.orphan_client": 0, "mqtt.identity_recreated": 0}
        self.last_error: str | None = None

    # -- driver ---------------------------------------------------------------
    async def run_forever(self) -> None:
        asyncio.ensure_future(self._listen())
        while True:
            try:
                await self.reconcile()
                self.last_error = None
            except Exception as exc:  # noqa: BLE001
                self.last_error = str(exc)
                log.exception("dynsec reconcile failed")
            self._wake.clear()
            try:
                await asyncio.wait_for(self._wake.wait(), timeout=self.reconcile_s)
            except asyncio.TimeoutError:
                pass

    async def _listen(self) -> None:
        """LISTEN wds_edges — provisioning paths NOTIFY so reconcile is
        near-instant, not bound to the 60 s cadence."""
        while True:
            try:
                conn = await self.pools.system.acquire()
                try:
                    await conn.add_listener(
                        NOTIFY_CHANNEL, lambda *a: self._wake.set())
                    while True:
                        await asyncio.sleep(3600)
                finally:
                    with contextlib.suppress(Exception):
                        await self.pools.system.release(conn)
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                log.exception("wds_edges listener dropped — retrying")
                await asyncio.sleep(5)

    # -- desired state (wds_system pre-context lookup, ADR-13 §3) -------------
    async def _desired(self) -> tuple[list[dict], list[dict]]:
        async with global_tx(self.pools.system) as conn:
            edges = await conn.fetch(
                "SELECT id, org_id, site_id, status, mqtt_username,"
                " credential_version FROM edges")
            idents = await conn.fetch(
                "SELECT id, org_id, edge_id, version, username, fingerprint,"
                " status, secret_issued, grace_until FROM edge_identities")
        return ([dict(r) for r in edges], [dict(r) for r in idents])

    # -- the sync pass ---------------------------------------------------------
    async def reconcile(self) -> None:
        edges, idents = await self._desired()
        edge_by_id = {str(e["id"]): e for e in edges}
        clients = await self.admin.list_clients()
        roles = await self.admin.list_roles()

        # --- infrastructure identities ------------------------------------
        # The init-created `admin` role is broad by design (recovery ladder);
        # converge it to $CONTROL-only here — adds apply before removals so
        # the admin never loses the ACL mid-edit that it needs to finish it.
        await self.admin.ensure_role("admin", ADMIN_ACLS, roles)

        pw = _read_secret_file(self.svc_backend_pw_file)
        if pw:
            await self.admin.ensure_role("svc-backend", BACKEND_ACLS, roles)
            if "svc-backend" not in clients:
                await self.admin.create_client("svc-backend", pw, "svc-backend")
                clients = await self.admin.list_clients()
                roles = await self.admin.list_roles()
            elif clients["svc-backend"]["disabled"]:
                # svc-backend is a service identity with no DB lifecycle —
                # a broker-side disable is tamper/accident, heal it (17 §6).
                await self.admin.enable_client("svc-backend")
                clients["svc-backend"]["disabled"] = False
                log.warning("svc-backend re-enabled (broker-side disable healed)")

        tester_pw = _read_secret_file(self.tester_pw_file)
        if tester_pw:
            # test profile only (docker-compose.test.yml / --profile test)
            await self.admin.ensure_role("tester", TESTER_ACLS, roles)
            if "tester" not in clients:
                await self.admin.create_client("tester", tester_pw, "tester")
            elif clients["tester"]["disabled"]:
                await self.admin.enable_client("tester")
        elif "tester" in clients and not clients["tester"]["disabled"]:
            # a stale tester from a previous --profile test run must not
            # survive into the default profile (doc 17 §2)
            await self.admin.disable_client("tester")

        # --- per-edge roles + clients ----------------------------------------
        desired_usernames: set[str] = set()
        now_utc = _utcnow()
        for ident in idents:
            edge = edge_by_id.get(str(ident["edge_id"]))
            if edge is None:
                continue
            org, site, eid = edge["org_id"], edge["site_id"], edge["id"]
            role = edge_role_name(eid)
            desired_usernames.add(ident["username"])
            if edge["status"] != "disabled":
                await self.admin.ensure_role(role, edge_acls(org, site, eid), roles)
                roles.add(role)

            broker = clients.get(ident["username"])
            ident_status = ident["status"]
            if edge["status"] == "disabled" or ident_status in ("disabled", "lost"):
                if broker and not broker["disabled"]:
                    await self.admin.disable_client(ident["username"])
                continue

            if ident_status == "grace":
                if self._grace_expired(ident, now_utc):
                    if broker and not broker["disabled"]:
                        await self.admin.disable_client(ident["username"])
                    await self._mark_disabled(ident)
                    continue
                if broker is None:
                    continue  # nothing to cut over from
                continue  # stays enabled inside the grace window

            # ident_status == 'active'
            if broker is None:
                await self._recreate_missing(edge, ident, idents, clients)
            elif broker["disabled"]:
                await self.admin.enable_client(ident["username"])

        # cut-over: a grace identity retires early once the edge is live on
        # its replacement (doc 17 §5 — "or until the edge connects with v{n+1}")
        for ident in idents:
            if ident["status"] != "grace" or self._grace_expired(ident, now_utc):
                continue
            edge = edge_by_id.get(str(ident["edge_id"]))
            if edge is None or edge["status"] == "disabled":
                continue
            newer = max(
                (i for i in idents
                 if i["edge_id"] == ident["edge_id"]
                 and i["version"] > ident["version"] and i["status"] == "active"),
                key=lambda i: i["version"], default=None)
            if newer is None:
                continue
            nc = await self.admin.get_client(newer["username"])
            if nc and nc.get("connections"):
                await self.admin.disable_client(ident["username"])
                await self._mark_disabled(ident)
                log.info("credential cut-over: edge %s now on v%d",
                         ident["edge_id"], newer["version"])

        # --- orphans: edge-* clients the DB doesn't know ----------------------
        for username, info in clients.items():
            if username.startswith("edge-") and username not in desired_usernames \
                    and not info["disabled"]:
                await self.admin.disable_client(username)
                self.counters["mqtt.orphan_client"] += 1
                log.warning("mqtt.orphan_client disabled",
                            extra={"username": username})

    def _grace_expired(self, ident: dict, now) -> bool:
        return ident["grace_until"] is not None and now >= ident["grace_until"]

    async def _mark_disabled(self, ident: dict) -> None:
        async with tenant_tx(self.pools.system, ident["org_id"]) as tc:
            await tc.execute(
                "UPDATE edge_identities SET status='disabled' WHERE id=$1",
                ident["id"])

    async def _recreate_missing(self, edge: dict, ident: dict,
                                idents: list[dict], clients: dict) -> None:
        """Broker lost a client the DB marks active. Bootstrap fast-path: if a
        mounted seed secret matches the stored fingerprint, recreate the SAME
        username with it. Otherwise mint a new credential version — the old
        secret is unrecoverable, so the edge shows needs_rotation (17 §6)."""
        pw = _read_secret_file(self.edge_bootstrap_pw_file)
        if pw and (not ident["fingerprint"]
                   or fingerprint(pw) == ident["fingerprint"]):
            await self.admin.ensure_role(
                edge_role_name(edge["id"]),
                edge_acls(edge["org_id"], edge["site_id"], edge["id"]))
            await self.admin.create_client(ident["username"], pw,
                                           edge_role_name(edge["id"]))
            if not ident["fingerprint"]:
                # first-boot adoption: record the bootstrap fingerprint so a
                # later broker wipe re-creates the same credential cleanly
                async with tenant_tx(self.pools.system, ident["org_id"]) as tc:
                    await tc.execute(
                        "UPDATE edge_identities SET fingerprint=$2 WHERE id=$1",
                        ident["id"], fingerprint(pw))
            log.info("dynsec client restored from bootstrap secret",
                     extra={"username": ident["username"]})
            return
        # new version, unknown-to-anyone secret — rotate to regain access
        version = max(
            [int(i["version"]) for i in idents if i["edge_id"] == edge["id"]]
            + [int(edge["credential_version"] or 0)]) + 1
        username = edge_client_name(edge["id"], version)
        secret = new_secret()
        await self.admin.ensure_role(
            edge_role_name(edge["id"]),
            edge_acls(edge["org_id"], edge["site_id"], edge["id"]))
        await self.admin.create_client(username, secret, edge_role_name(edge["id"]))
        async with tenant_tx(self.pools.system, edge["org_id"]) as tc:
            await tc.execute(
                "UPDATE edge_identities SET status='lost' WHERE id=$1", ident["id"])
            await tc.execute(
                "INSERT INTO edge_identities(org_id, edge_id, version, username,"
                " fingerprint, status, secret_issued)"
                " VALUES ($1,$2,$3,$4,$5,'active',false)",
                edge["org_id"], edge["id"], version, username, fingerprint(secret))
            await tc.execute(
                "UPDATE edges SET credential_version=$2, mqtt_username=$3,"
                " credential_fingerprint=$4 WHERE id=$1",
                edge["id"], version, username, fingerprint(secret))
        self.counters["mqtt.identity_recreated"] += 1
        log.warning("dynsec client recreated as %s (needs_rotation)", username)


def _utcnow():
    return datetime.now(timezone.utc)
