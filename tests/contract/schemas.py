"""Pure-Python contract module — the executable reading of the binding docs.

Doc 17 (MQTT security contract) is BINDING for the wire: topics live under
`v2/{org_id}/{site_id}/{edge_id}/...` with UUID-only identity, and the
command/response payloads carry `tag_path` and the v2 status vocabulary.
Tag *names* still obey the CONTRACT.md UNS rules via the DB `tags.path`
(column exists already; the dotted name is the site code + path).

Everything here is stdlib-only so the unit/contract suite runs with zero
services and zero third-party deps.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

# --------------------------------------------------------------------------
# Constants — CONTRACT.md names + doc 17 §1 UUIDs (dev-seed values)
# --------------------------------------------------------------------------

SITE = "plant1"                       # site CODE (tag naming), not a topic seg
EDGE_ID = "edge1"                     # legacy v1 name — kept for tag lookups
ORG_ID = "0199d000-0000-7000-8000-00000000a001"
SITE_ID = "0199d000-0000-7000-8000-00000000b001"
EDGE_UUID = "0199d000-0000-7000-8000-00000000c001"
V2_PREFIX = f"v2/{ORG_ID}/{SITE_ID}/{EDGE_UUID}"

#: TagValue.quality — CONTRACT.md "MQTT topics" table + 05 §2.
QUALITIES = frozenset({"good", "bad", "stale", "uncertain"})

#: Backend command lifecycle — CONTRACT.v2 §6 / backend commands table.
COMMAND_STATUSES = frozenset(
    {"accepted", "dispatched", "acknowledged", "rejected", "failed", "timeout"}
)
TERMINAL_STATUSES = frozenset({"acknowledged", "rejected", "failed", "timeout"})
#: Statuses that count as "in-flight" for the one-command-per-tag rule.
IN_FLIGHT_STATUSES = frozenset({"accepted", "dispatched"})

#: The v1 WS/REST shim still surfaces the CONTRACT.md vocabulary — the
#: backend maps v2 -> v1 wire names for the compatibility surface.
V1_COMMAND_STATUSES = frozenset(
    {"issued", "sent", "acked", "done", "denied", "failed", "timeout"}
)

#: What the *edge* may publish on cmd-resp (doc 17 §6). "timeout" is NOT an
#: edge status; it is assigned by the backend when no resp arrives in ttl_s.
EDGE_RESP_STATUSES = frozenset({"acknowledged", "rejected", "failed"})
EDGE_STATUS_MAP = {
    "acknowledged": "acknowledged", "rejected": "rejected", "failed": "failed",
}

#: `reason` vocabulary for status=rejected. Doc 17 §6 names the field
#: `reason`; the value set follows the contract denied-details plus the
#: transport-level rejections the edge itself reports.
REJECTED_REASONS = frozenset(
    {"not_writable", "interlock", "ttl_expired", "clock_untrusted",
     "out_of_range", "retained_command", "future_issued_at",
     "invalid_command", "invalid_value"}
)

ALARM_SEVERITIES = frozenset({"info", "warning", "critical"})
#: CONTRACT.md alarm object: state:active|acked.
#: DIVERGENCE: 05 §3 alarms.status CHECK also allows 'cleared'; CONTRACT.md
#: (binding) lists only active|acked — kept strict, flagged for review.
ALARM_STATES = frozenset({"active", "acked"})

#: CONTRACT.md WS section: close code **4401**.
#: DIVERGENCE: 09 §6.6 test table says close code 4001; CONTRACT.md wins: 4401.
WS_CLOSE_AUTH_EXPIRED = 4401

#: Demo tokens — CONTRACT.md "Auth".
TOKENS = {"demo-operator": "operator", "demo-viewer": "viewer"}

#: Sim tag registry — CONTRACT.md "Sim tags" table.
SIM_TAGS: dict[str, dict] = {
    "plant1.sort.line1.motor1.running": {"type": "bool", "writable": True},
    "plant1.sort.line1.motor1.speed_sp": {
        "type": "num",
        "writable": True,
        "range": (0.0, 60.0),
    },
    "plant1.sort.line1.conv1.speed_mps": {"type": "num", "writable": False},
    "plant1.sort.line1.conv1.temp_c": {"type": "num", "writable": False},
    "plant1.sort.line1.bin1.level_pct": {"type": "num", "writable": False},
    "plant1.sort.vision.cam1.gravel_ratio": {"type": "num", "writable": False},
}

#: Seed alarm rule — CONTRACT.md "REST".
SEED_ALARM_RULE = {"tag": "plant1.sort.line1.conv1.temp_c", "op": ">", "threshold": 80.0,
                   "severity": "critical"}

#: Edge heartbeat cadence — CONTRACT.md says every 5s.
#: DIVERGENCE: 04 §6 says every 10s; CONTRACT.md wins: 5s.
HEARTBEAT_INTERVAL_S = 5

#: Clock-skew tolerance — CONTRACT.md "Sim tags" notes (>500ms → untrusted).
CLOCK_SKEW_TOLERANCE_MS = 500

# --------------------------------------------------------------------------
# Topic / tag-name layer  (CONTRACT.md "MQTT topics" + 05 §1 governance)
# --------------------------------------------------------------------------

# Tag segments: lowercase alnum + underscore (UNS naming rule, 04 §3/05 §1).
_TAG_SEG_RE = re.compile(r"^[a-z0-9_]+$")
# Topic segments: same plus '-' (needed for req_id uuids and 'cmd-resp').
_TOPIC_SEG_RE = re.compile(r"^[A-Za-z0-9_-]+$")
_MAX_TOPIC_BYTES = 65535  # MQTT spec limit on topic name length

# Reserved second-level subtrees — never valid as a telemetry `area`.
# 'cmd'/'cmd-resp'/'sys' are outside the UNS namespace (05 §1 governance);
# 'edge' is the heartbeat subtree. DIVERGENCE-free extension: 'edge' is
# reserved by the same logic even though 05 only names cmd/sys.
RESERVED_AREA_SEGMENTS = frozenset({"cmd", "cmd-resp", "sys", "edge"})

# '_derived' is the only '_' -prefixed device allowed (computed tags, 05 §1).
DERIVED_DEVICE_PREFIX = "_derived"


_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def is_uuid(value: str) -> bool:
    """Doc 17 §1: org/site/edge topic segments are immutable UUIDs only —
    human names like 'plant1' or 'edge1' must NOT pass."""
    return isinstance(value, str) and bool(_UUID_RE.match(value))


@dataclass
class TopicInfo:
    """Result of classifying an MQTT topic (doc 17 §1 v2 namespace)."""

    kind: str  # telemetry|heartbeat|command|command_response|invalid
    segments: list[str] = field(default_factory=list)
    org_id: str | None = None
    site_id: str | None = None
    edge_id: str | None = None
    command_id: str | None = None
    tag_path: str | None = None  # set only for telemetry (slashes form)
    errors: list[str] = field(default_factory=list)


def validate_tag_name(name: object, *, site: str = SITE) -> list[str]:
    """Validate a dotted UNS tag name: `{site}.{area}.{line}.{device}.{signal}`.

    Returns a list of error strings; empty list means valid.
    """
    errors: list[str] = []
    if not isinstance(name, str):
        return ["tag name must be a string"]
    if not name:
        return ["tag name must be non-empty"]
    if name != name.strip():
        errors.append("tag name must not have leading/trailing whitespace")
    if not name.isascii():
        errors.append("tag name must be ASCII")
    # Reject characters that are dangerous in MQTT topics, shells or SQL.
    # (Defense-in-depth for the ATTACK_PLAN SQL-ish tag scenario — tag names
    # are used as URL path segments and MQTT topic tails.)
    if any(c in name for c in "'\"\\; \t\n\r+#"):
        errors.append("tag name contains forbidden characters")
    segments = name.split(".")
    if len(segments) != 5:
        errors.append(
            f"tag name must have exactly 5 segments "
            f"({{site}}.{{area}}.{{line}}.{{device}}.{{signal}}), got {len(segments)}"
        )
        return errors  # deeper checks need exactly 5
    for i, seg in enumerate(segments):
        if not _TAG_SEG_RE.match(seg):
            errors.append(f"segment {i} ({seg!r}) must match {_TAG_SEG_RE.pattern}")
    if segments[0] != site:
        errors.append(f"site segment must be {site!r}, got {segments[0]!r}")
    if segments[1] in RESERVED_AREA_SEGMENTS:
        errors.append(
            f"area segment {segments[1]!r} is reserved (cmd/cmd-resp/sys/edge "
            "live outside the UNS telemetry namespace)"
        )
    device = segments[3]
    if device.startswith("_") and device != DERIVED_DEVICE_PREFIX:
        errors.append(
            f"device segment {device!r} must not start with '_'; "
            f"only {DERIVED_DEVICE_PREFIX!r} is allowed (computed tags)"
        )
    return errors


def tag_to_topic(tag: str) -> str:
    """Dotted tag name → MQTT topic path (mapping rule locked in 05 §1)."""
    return tag.replace(".", "/")


def topic_to_tag(topic: str) -> str:
    """Inverse of tag_to_topic for telemetry topics."""
    return topic.replace("/", ".")


def _topic_shape_errors(topic: object) -> list[str]:
    """Generic MQTT topic-name sanity (concrete topics, not subscriptions)."""
    errors: list[str] = []
    if not isinstance(topic, str):
        return ["topic must be a string"]
    if not topic:
        return ["topic must be non-empty"]
    if not topic.isascii():
        errors.append("topic must be ASCII")
    if len(topic.encode()) > _MAX_TOPIC_BYTES:
        errors.append(f"topic exceeds {_MAX_TOPIC_BYTES} bytes")
    if "\x00" in topic:
        errors.append("topic must not contain NUL")
    if "+" in topic or "#" in topic:
        errors.append("concrete topic must not contain wildcards +/#")
    if topic.startswith("/") or topic.endswith("/") or "//" in topic:
        errors.append("topic must not have leading/trailing/empty '/' segments")
    for seg in topic.split("/"):
        if not seg:
            continue  # already reported via '//' check
        if not _TOPIC_SEG_RE.match(seg):
            errors.append(f"topic segment {seg!r} must match {_TOPIC_SEG_RE.pattern}")
    return errors


def classify_topic(topic: object) -> TopicInfo:
    """Classify a concrete MQTT topic per doc 17 §1 — the BINDING namespace.

    Layouts (all segments literal `v2`, then UUIDs only):
      v2/{org_id}/{site_id}/{edge_id}/tele/{area}/{line}/{device}/{signal}
      v2/{org_id}/{site_id}/{edge_id}/hb
      v2/{org_id}/{site_id}/{edge_id}/cmd/{command_id}
      v2/{org_id}/{site_id}/{edge_id}/cmd-resp/{command_id}
    """
    errors = _topic_shape_errors(topic)
    if errors:
        return TopicInfo(kind="invalid", errors=errors)
    segs = topic.split("/")
    info = TopicInfo(kind="invalid", segments=segs, errors=[])
    if segs[0] != "v2":
        info.errors.append(f"namespace must be 'v2', got {segs[0]!r}")
        return info
    if len(segs) < 5:
        info.errors.append("v2 topic needs at least v2/{org}/{site}/{edge}/{kind}")
        return info
    for i, label in ((1, "org_id"), (2, "site_id"), (3, "edge_id")):
        if not is_uuid(segs[i]):
            info.errors.append(f"{label} must be a UUID, got {segs[i]!r}")
            return info
    info.org_id, info.site_id, info.edge_id = segs[1], segs[2], segs[3]

    kind = segs[4]
    if kind == "hb" and len(segs) == 5:
        info.kind = "heartbeat"
        return info
    if kind in ("cmd", "cmd-resp") and len(segs) == 6:
        info.kind = "command" if kind == "cmd" else "command_response"
        info.command_id = segs[5]
        return info
    if kind == "tele" and len(segs) >= 6:
        path = "/".join(segs[5:])
        for seg in segs[5:]:
            if not _TAG_SEG_RE.match(seg):
                info.errors.append(
                    f"telemetry path segment {seg!r} must match {_TAG_SEG_RE.pattern}")
                return info
        info.kind = "telemetry"
        info.tag_path = path
        return info
    info.errors.append(f"topic does not match any doc-17 layout: {topic!r}")
    return info


# --------------------------------------------------------------------------
# Timestamps — CONTRACT.md requires ISO8601 UTC with 'Z'
# --------------------------------------------------------------------------

_TS_Z_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$")


def parse_ts(value: object) -> datetime:
    """Parse a contract timestamp: ISO8601, UTC, explicit 'Z' suffix.

    CONTRACT.md writes ``<ISO8601 UTC Z>`` everywhere — the strict reading is
    that offsets like ``+00:00`` and naive datetimes are NOT contract-valid.
    Raises ValueError on any violation.
    """
    if not isinstance(value, str):
        raise ValueError("ts must be a string")
    if not _TS_Z_RE.match(value):
        raise ValueError(f"ts must be ISO8601 UTC with 'Z' suffix, got {value!r}")
    # strptime additionally enforces real calendar values (no 2025-13-45).
    fmt = "%Y-%m-%dT%H:%M:%S.%fZ" if "." in value else "%Y-%m-%dT%H:%M:%SZ"
    return datetime.strptime(value, fmt).replace(tzinfo=timezone.utc)


# --------------------------------------------------------------------------
# Payload validators
# --------------------------------------------------------------------------

def _is_finite_number(v: object) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def validate_tag_value(payload: object) -> list[str]:
    """Telemetry payload on `{site}/{a}/{l}/{d}/{s}` topics: {v, q, ts}."""
    if not isinstance(payload, dict):
        return ["payload must be a JSON object"]
    errors: list[str] = []
    for key in ("v", "q", "ts"):
        if key not in payload:
            errors.append(f"missing required field {key!r}")
    if "v" in payload:
        v = payload["v"]
        # CONTRACT.md: {"v": <num|bool>} — strings are not contract-valid on
        # the wire even though 05 §2 TagValue mentions str; binding doc wins.
        if not (isinstance(v, bool) or _is_finite_number(v)):
            errors.append("v must be a finite number or boolean")
    if "q" in payload and payload["q"] not in QUALITIES:
        errors.append(f"q must be one of {sorted(QUALITIES)}")
    if "ts" in payload:
        try:
            parse_ts(payload["ts"])
        except ValueError as e:
            errors.append(str(e))
    return errors


def validate_heartbeat(payload: object) -> list[str]:
    """Heartbeat payload on `v2/{o}/{s}/{e}/hb` (doc 17 §6)."""
    if not isinstance(payload, dict):
        return ["payload must be a JSON object"]
    errors: list[str] = []
    # 'up' steady-state, 'degraded' alive-but-impaired, 'down' via LWT.
    status = payload.get("status")
    if status not in ("up", "degraded", "down"):
        errors.append("status must be 'up'|'degraded'|'down'")
    if payload.get("clock_ok") is not None and not isinstance(payload.get("clock_ok"), bool):
        errors.append("clock_ok must be a boolean or null")
    # The LWT 'down' message is terse (broker publishes it for a dead edge —
    # it can't know adapter/ts); live heartbeats carry the full schema.
    if status != "down":
        if not isinstance(payload.get("adapter"), str) or not payload.get("adapter"):
            errors.append("adapter must be a non-empty string")
        try:
            parse_ts(payload.get("ts"))
        except ValueError as e:
            errors.append(str(e))
    return errors


def validate_tag_path(path: object) -> list[str]:
    """A site-relative tag path `area/line/device/signal` (doc 17 §1 tele
    topic tail + cmd payload `tag_path`)."""
    if not isinstance(path, str):
        return ["tag_path must be a string"]
    if not path:
        return ["tag_path must be non-empty"]
    errors: list[str] = []
    segs = path.split("/")
    if len(segs) != 4:
        errors.append(
            f"tag_path must have exactly 4 segments "
            f"(area/line/device/signal), got {len(segs)}")
    for i, seg in enumerate(segs):
        if not _TAG_SEG_RE.match(seg):
            errors.append(f"tag_path segment {i} ({seg!r}) must match {_TAG_SEG_RE.pattern}")
    return errors


def validate_rest_command_request(payload: object) -> list[str]:
    """POST /api/commands body: {tag, value, ttl_s?, idempotency_key?}."""
    if not isinstance(payload, dict):
        return ["payload must be a JSON object"]
    errors: list[str] = []
    if "tag" not in payload:
        errors.append("missing required field 'tag'")
    else:
        errors.extend(validate_tag_name(payload["tag"]))
    if "value" not in payload:
        errors.append("missing required field 'value'")
    else:
        v = payload["value"]
        if not (isinstance(v, bool) or _is_finite_number(v)):
            errors.append("value must be a finite number or boolean")
    if "ttl_s" in payload:
        ttl = payload["ttl_s"]
        if not _is_finite_number(ttl):
            errors.append("ttl_s must be a finite number")
        elif ttl <= 0:
            errors.append("ttl_s must be > 0")
    if "idempotency_key" in payload:
        k = payload["idempotency_key"]
        if not isinstance(k, str) or not (1 <= len(k) <= 255):
            errors.append("idempotency_key must be a string of 1..255 chars")
    return errors


def validate_mqtt_command(payload: object) -> list[str]:
    """Command payload on `v2/{o}/{s}/{e}/cmd/{command_id}` (doc 17 §6):

    {command_id, tag_path, value, issued_at, ttl_s, idempotency_key, user}.
    """
    if not isinstance(payload, dict):
        return ["payload must be a JSON object"]
    errors: list[str] = []
    for key in ("command_id", "tag_path", "value", "issued_at", "ttl_s",
                "idempotency_key", "user"):
        if key not in payload:
            errors.append(f"missing required field {key!r}")
    if "command_id" in payload and (
        not isinstance(payload["command_id"], str) or not payload["command_id"]
    ):
        errors.append("command_id must be a non-empty string")
    if "tag_path" in payload:
        errors.extend(validate_tag_path(payload["tag_path"]))
    if "value" in payload:
        v = payload["value"]
        if not (isinstance(v, bool) or _is_finite_number(v)):
            errors.append("value must be a finite number or boolean")
    if "issued_at" in payload:
        try:
            parse_ts(payload["issued_at"])
        except ValueError as e:
            errors.append(str(e))
    if "ttl_s" in payload:
        ttl = payload["ttl_s"]
        if not _is_finite_number(ttl):
            errors.append("ttl_s must be a finite number")
        elif ttl <= 0:
            errors.append("ttl_s must be > 0")
    if "idempotency_key" in payload:
        k = payload["idempotency_key"]
        if not isinstance(k, str) or not (1 <= len(k) <= 255):
            errors.append("idempotency_key must be a string of 1..255 chars")
    if "user" in payload and (
        not isinstance(payload["user"], str) or not payload["user"]
    ):
        errors.append("user must be a non-empty string")
    return errors


def validate_command_response(payload: object) -> list[str]:
    """cmd-resp payload (doc 17 §6): {command_id, status, reason, ts}.

    status ∈ acknowledged|rejected|failed — 'timeout' is NOT a legal edge
    status; the backend assigns it. `reason` carries the detail.
    """
    if not isinstance(payload, dict):
        return ["payload must be a JSON object"]
    errors: list[str] = []
    if not isinstance(payload.get("command_id"), str) or not payload.get("command_id"):
        errors.append("command_id must be a non-empty string")
    status = payload.get("status")
    if status not in EDGE_RESP_STATUSES:
        errors.append(
            f"status must be one of {sorted(EDGE_RESP_STATUSES)} "
            f"(edge never sends 'timeout'), got {status!r}"
        )
    if "reason" in payload and not isinstance(payload["reason"], str):
        errors.append("reason must be a string when present")
    return errors


def validate_alarm(payload: object) -> list[str]:
    """Alarm object per CONTRACT.md REST: {id, tag, rule, severity, state, ts}."""
    if not isinstance(payload, dict):
        return ["alarm must be a JSON object"]
    errors: list[str] = []
    for key in ("id", "tag", "rule", "severity", "state", "ts"):
        if key not in payload:
            errors.append(f"missing required field {key!r}")
    if "tag" in payload:
        errors.extend(validate_tag_name(payload["tag"]))
    if "severity" in payload and payload["severity"] not in ALARM_SEVERITIES:
        errors.append(f"severity must be one of {sorted(ALARM_SEVERITIES)}")
    if "state" in payload and payload["state"] not in ALARM_STATES:
        errors.append(f"state must be one of {sorted(ALARM_STATES)}")
    if "ts" in payload:
        try:
            parse_ts(payload["ts"])
        except ValueError as e:
            errors.append(str(e))
    return errors


def map_edge_status(edge_status: str) -> str:
    """cmd-resp status → backend command status (doc 17 §6 — 1:1 vocabulary)."""
    if edge_status not in EDGE_STATUS_MAP:
        raise ValueError(f"illegal edge status {edge_status!r}")
    return EDGE_STATUS_MAP[edge_status]


# --------------------------------------------------------------------------
# Command lifecycle state machine — CONTRACT.md "Command lifecycle"
# --------------------------------------------------------------------------

# Legal (from → to) transitions — CONTRACT.v2 §6 vocabulary.
#   accepted   → dispatched : MQTT publish ok
#   accepted   → failed     : publish itself failed
#   accepted   → timeout    : no resp within ttl_s even if publish tracking lost
#   dispatched → acknowledged|rejected|failed : edge cmd-resp observed
#   dispatched → timeout    : no resp within ttl_s
# Terminals (acknowledged|rejected|failed|timeout) have no outgoing edges.
LEGAL_TRANSITIONS: dict[str, frozenset[str]] = {
    "accepted": frozenset({"dispatched", "failed", "timeout"}),
    "dispatched": frozenset({"acknowledged", "rejected", "failed", "timeout"}),
    "acknowledged": frozenset(),
    "rejected": frozenset(),
    "failed": frozenset(),
    "timeout": frozenset(),
}


def is_legal_transition(frm: str, to: str) -> bool:
    if frm not in COMMAND_STATUSES or to not in COMMAND_STATUSES:
        return False
    return to in LEGAL_TRANSITIONS[frm]


def is_terminal(status: str) -> bool:
    return status in TERMINAL_STATUSES


# --------------------------------------------------------------------------
# POST /api/commands resolution — dedup BEFORE conflict (09 §6.6)
# --------------------------------------------------------------------------

@dataclass
class PostResolution:
    http_status: int
    command_id: str | None = None
    active_command_id: str | None = None


def resolve_command_post(
    *,
    replayed_command_id: str | None,
    inflight_command_id: str | None,
    new_command_id: str = "<new>",
) -> PostResolution:
    """Order of checks locked by 09 §6.6 test_idempotent_replay_after_409:

    1. same idempotency_key + same user → 200 + existing command_id
    2. same tag already in-flight        → 409 + active_command_id
    3. otherwise                          → 201 + new command_id
    """
    if replayed_command_id is not None:
        return PostResolution(http_status=200, command_id=replayed_command_id)
    if inflight_command_id is not None:
        return PostResolution(
            http_status=409, active_command_id=inflight_command_id
        )
    return PostResolution(http_status=201, command_id=new_command_id)


# --------------------------------------------------------------------------
# Edge command pipeline — mirrors 04 §5 decision order + CONTRACT.md sim rules
# --------------------------------------------------------------------------

@dataclass
class EdgeResult:
    status: str  # acknowledged | rejected | failed  (doc 17 §6)
    reason: str | None = None


def edge_evaluate_command(
    cmd: dict,
    *,
    now: datetime,
    clock_ok: bool = True,
    registry: dict[str, dict] | None = None,
    site: str = SITE,
) -> EdgeResult:
    """Sim of the edge decision pipeline (04 §5, doc 17 §6 wire vocabulary):

    step 0: clock trustworthy? → rejected/clock_untrusted
            then TTL check     → rejected/ttl_expired
    step 1: tag writable?       → rejected/not_writable
    step 2: adapter write       → rejected/out_of_range (sim range rule),
                                 failed/bad_value_type (type mismatch),
                                 rejected/interlock (device refuses)
    step 3: acknowledged

    `cmd["tag_path"]` is the site-relative path (doc 17 §6); it resolves to
    the registry's dotted `{site}.{path}` name.
    """
    if registry is None:
        registry = SIM_TAGS

    # step 0a — clock must be trusted before trusting issued_at comparisons
    if not clock_ok:
        return EdgeResult(status="rejected", reason="clock_untrusted")

    # step 0b — TTL: edge_now > issued_at + ttl_s → drop, deny
    issued_at = parse_ts(cmd["issued_at"])
    ttl_s = cmd["ttl_s"]
    if now > issued_at + timedelta(seconds=ttl_s):
        return EdgeResult(status="rejected", reason="ttl_expired")

    # step 1 — writable allowlist (unknown tag == not writable, CONTRACT.md)
    tag_path = cmd.get("tag_path") or cmd.get("tag", "")
    dotted = tag_path.replace("/", ".")
    if not dotted.startswith(f"{site}."):
        dotted = f"{site}.{dotted}"
    meta = registry.get(dotted)
    if meta is None or not meta.get("writable"):
        return EdgeResult(status="rejected", reason="not_writable")

    # step 2 — adapter write checks
    value = cmd["value"]
    expected = meta["type"]
    if expected == "bool" and not isinstance(value, bool):
        return EdgeResult(status="failed", reason="bad_value_type")
    if expected == "num" and not _is_finite_number(value):
        return EdgeResult(status="failed", reason="bad_value_type")
    rng = meta.get("range")
    if rng is not None and not (rng[0] <= value <= rng[1]):
        return EdgeResult(status="rejected", reason="out_of_range")

    return EdgeResult(status="acknowledged")


# --------------------------------------------------------------------------
# AuthN/Z — CONTRACT.md "Auth" + RBAC intent from 08 §2
# --------------------------------------------------------------------------

ROLE_ANONYMOUS = "anonymous"


def role_for_token(token: str | None) -> str:
    """Header `Authorization: Bearer <token>` → role.

    Unknown/absent tokens map to anonymous (fail-closed: anonymous can only
    read, so a bad token can never gain write access).
    AMBIGUITY: CONTRACT.md doesn't say whether a *malformed* token on a
    mutating endpoint should be 401 (treated as no token) or 403 — we treat
    it as anonymous → 401, flagged for review.
    """
    if not token:
        return ROLE_ANONYMOUS
    return TOKENS.get(token, ROLE_ANONYMOUS)


def expected_mutation_status(role: str, endpoint: str) -> int:
    """Expected HTTP status for a mutating call, before body validation.

    endpoint: 'command' (POST /api/commands) or 'alarm_ack' (POST /api/alarms/{id}/ack)
    CONTRACT.md: no token → 401, viewer on command → 403.
    Alarm ack is "auth required" (CONTRACT.md) and operator-scoped per
    'demo-operator (role operator: read+command+ack)' → viewer gets 403.
    """
    if endpoint not in ("command", "alarm_ack"):
        raise ValueError(f"unknown mutating endpoint {endpoint!r}")
    if role == ROLE_ANONYMOUS:
        return 401
    if role == "viewer":
        return 403
    if role == "operator":
        return 201 if endpoint == "command" else 200
    raise ValueError(f"unknown role {role!r}")


def can_read(role: str) -> bool:
    """v4 T5 / CONTRACT.v2: anonymous reads are gone — every /api/* GET
    requires an authenticated org member; /api/health stays machine-public."""
    return role != ROLE_ANONYMOUS


# --------------------------------------------------------------------------
# WebSocket contract — CONTRACT.md "WebSocket /ws"
# --------------------------------------------------------------------------

#: Events any connection may receive (CONTRACT.md WS list, minus auth-only).
WS_PUBLIC_EVENTS = frozenset({"tag", "tags", "alarm", "alarm_update", "health"})
#: Events that require an authenticated (operator) connection.
#: 06 §2: "Public connection ได้เฉพาะ tag, tags, alarm, health — ไม่ได้
#: command events"; 09 §7 security test: WS '*' must not leak command events
#: to anonymous. CONTRACT.md does NOT state the restriction explicitly.
#: DIVERGENCE/AMBIGUITY: we encode the restrictive reading (06/08/09) and flag
#: it — if the demo backend follows CONTRACT.md literally and streams command
#: events to anonymous clients, this is a red-team finding.
WS_AUTHED_EVENTS = WS_PUBLIC_EVENTS | frozenset(
    {"command", "auth_expiring", "auth_expired"}
)

_WS_EVENT_REQUIRED = {
    "tag": {"name", "v", "q", "ts"},
    "tags": {"items"},
    "alarm": set(),  # 'alarm object' — shape covered by validate_alarm loosely
    "alarm_update": set(),
    "command": {"command_id", "status", "tag"},
    "health": {"mqtt", "edge"},
    "auth_expiring": {"in_s"},
    "auth_expired": set(),
}


def ws_events_allowed(role: str) -> frozenset[str]:
    """Event types a connection with this role may receive."""
    if role == "operator":
        return WS_AUTHED_EVENTS
    return WS_PUBLIC_EVENTS


def validate_ws_event(event: object) -> list[str]:
    """Validate a server→client WS message per CONTRACT.md event list."""
    if not isinstance(event, dict):
        return ["event must be a JSON object"]
    etype = event.get("type")
    if etype not in _WS_EVENT_REQUIRED:
        return [f"unknown event type {etype!r}"]
    errors: list[str] = []
    missing = _WS_EVENT_REQUIRED[etype] - event.keys()
    for key in sorted(missing):
        errors.append(f"event type {etype!r} missing required field {key!r}")
    if etype == "tag":
        errors.extend(
            e for e in validate_tag_value(
                {"v": event.get("v"), "q": event.get("q"), "ts": event.get("ts")}
            )
        )
        if "name" in event:
            errors.extend(validate_tag_name(event["name"]))
    if etype == "command":
        # the /ws shim carries the v1 vocabulary (backend maps v2 -> v1)
        if event.get("status") not in V1_COMMAND_STATUSES:
            errors.append(f"command.status must be a lifecycle status")
        if "tag" in event:
            errors.extend(validate_tag_name(event["tag"]))
    if etype == "health":
        if event.get("mqtt") not in ("up", "down"):
            errors.append("health.mqtt must be 'up'|'down'")
        if event.get("edge") not in ("up", "stale"):
            errors.append("health.edge must be 'up'|'stale'")
    return errors
