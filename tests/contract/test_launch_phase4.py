"""Launch-blocker contract tests (roadmap §8 + Phase 4 "make real").

Covers the parts checkable without services: route shapes, cursor codecs,
payload validation, version comparison, and the six-step onboarding shape.
Runtime behaviour (tenant isolation, MQTT ingest, auth) is covered by the
integration/tenancy gates — these tests freeze the CONTRACT so a refactor
can't silently change it.
"""

from __future__ import annotations

import inspect
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from app import consents, edgelogs, eventsfeed, onboarding, statuspage, tagquery


# ------------------------------------------------------------------ routes
def _paths(module) -> dict[tuple[str, str], object]:
    out = {}
    for r in module.router.routes:
        for method in r.methods or ():
            out[(method, r.path)] = r.endpoint
    return out


def test_events_route_shape():
    eps = _paths(eventsfeed)
    assert ("GET", "/api/v1/orgs/{org}/events") in eps
    sig = inspect.signature(eps[("GET", "/api/v1/orgs/{org}/events")])
    for p in ("type", "site", "tag", "from_", "to", "cursor", "limit"):
        assert p in sig.parameters, f"events feed missing filter param {p!r}"


def test_events_union_covers_all_four_sources():
    for src in ("alarms", "command_events", "audit_log", "incident_events"):
        assert src in eventsfeed._UNION, f"events feed must merge {src}"


def test_events_cursor_roundtrip():
    ts = datetime(2026, 10, 16, 12, 30, 0, 123456, tzinfo=timezone.utc)
    raw = eventsfeed.encode_cursor(ts, "alarm:abc:raised")
    back_ts, back_id = eventsfeed.decode_cursor(raw)
    assert back_id == "alarm:abc:raised"
    assert abs((back_ts - ts).total_seconds()) < 0.001


@pytest.mark.parametrize("bad", ["", "not-base64!!", "aGVsbG8=", "MTIzfA=="])  # "123|"
def test_events_cursor_rejects_garbage(bad):
    with pytest.raises(HTTPException) as e:
        eventsfeed.decode_cursor(bad)
    assert e.value.status_code == 400


def test_events_bad_type_validation_source():
    # the type param is a whitelist — anything outside must 422, not 500
    assert eventsfeed.EVENT_TYPES == frozenset({"alarm", "command", "config", "incident"})


# ------------------------------------------------------------------ consent
def test_consent_routes():
    eps = _paths(consents)
    assert ("GET", "/api/v1/consents") in eps
    assert ("POST", "/api/v1/consents") in eps


def test_consent_docs_from_config():
    assert set(consents.DOCS) == {"tos", "privacy"}
    for v in consents.config.CONSENT_VERSION.values():
        assert len(v.split("-")) == 3, f"CONSENT_VERSION must be a date-ish version, got {v!r}"


def test_consent_version_key_ordering():
    assert consents.version_key("2026-10-16") < consents.version_key("2026-11-01")
    assert consents.version_key("garbage") == (0,)
    assert consents.version_key("2026-09-01") < consents.version_key("2026-10-16")


def test_consent_missing_docs_logic():
    req = {"tos": "2026-10-16", "privacy": "2026-10-16"}
    assert consents.missing_docs({"tos": "2026-10-16", "privacy": "2026-10-16"}, req) == []
    assert consents.missing_docs({"tos": "2026-01-01", "privacy": "2026-10-16"}, req) == ["tos"]
    assert sorted(consents.missing_docs({}, req)) == ["privacy", "tos"]
    # a NEWER recorded version is not missing (docs released after enrolment)
    assert consents.missing_docs({"tos": "2099-01-01", "privacy": "2026-10-16"}, req) == []


def test_consent_gate_is_fail_open_only_when_table_missing():
    # has_current_consent must check to_regclass first — read the source so a
    # refactor can't drop the pre-migration safety net.
    src = inspect.getsource(consents.has_current_consent)
    assert "to_regclass('consents')" in src


# ---------------------------------------------------------------- edge logs
def test_edgelogs_route_shape():
    eps = _paths(edgelogs)
    assert ("GET", "/api/v1/orgs/{org}/edge-logs") in eps
    sig = inspect.signature(eps[("GET", "/api/v1/orgs/{org}/edge-logs")])
    for p in ("edge", "level", "q", "from_", "to", "cursor", "limit"):
        assert p in sig.parameters


def test_parse_log_batch_single_and_batch():
    e = {"ts": "2026-10-16T10:00:00Z", "level": "error", "source": "adapter:modbus", "msg": "crc fail"}
    single = edgelogs.parse_log_batch(e)
    assert len(single) == 1 and single[0]["level"] == "error"
    batch = edgelogs.parse_log_batch({"logs": [e, e]})
    assert len(batch) == 2
    assert batch[0]["level"] == "error" and batch[0]["source"] == "adapter:modbus"


def test_parse_log_batch_normalizes():
    e = edgelogs.parse_log_batch(
        {"ts": 1760620000, "level": "WARNING", "source": "x", "msg": "hi"})[0]
    assert e["level"] == "warn"                       # warning -> warn
    assert e["ts"].tzinfo is not None                 # epoch -> aware dt
    e2 = edgelogs.parse_log_batch(
        {"ts": "bad-ts", "level": "info", "msg": "x"})  # unusable ts -> dropped
    assert e2 == []
    e3 = edgelogs.parse_log_batch(
        {"ts": "2026-10-16T10:00:00Z", "level": "bogus", "source": "s", "msg": "m"})[0]
    assert e3["level"] == "info"                      # unknown level -> info


def test_parse_log_batch_rejects_non_payloads():
    assert edgelogs.parse_log_batch(b"not json") == []
    assert edgelogs.parse_log_batch(42) == []
    assert edgelogs.parse_log_batch({"unexpected": True}) == []


def test_parse_log_batch_caps_and_truncates():
    many = [{"ts": "2026-10-16T10:00:00Z", "msg": f"m{i}"} for i in range(500)]
    assert len(edgelogs.parse_log_batch(many)) == edgelogs.MAX_BATCH
    e = edgelogs.parse_log_batch(
        {"ts": "2026-10-16T10:00:00Z", "source": "s" * 200, "msg": "m" * 5000})[0]
    assert len(e["source"]) == edgelogs.MAX_SOURCE
    assert len(e["msg"]) == edgelogs.MAX_MSG


# ---------------------------------------------------------------- onboarding
def test_onboarding_route_and_six_steps():
    eps = _paths(onboarding)
    assert ("GET", "/api/v1/orgs/{org}/onboarding") in eps
    assert len(onboarding.STEPS) == 6
    ids = [s[0] for s in onboarding.STEPS]
    assert ids == ["gateway", "data", "dashboard", "alarm_rule", "notify", "teammate"]
    assert all(isinstance(href, str) and href.startswith("/") for _i, href in onboarding.STEPS)


# ----------------------------------------------------------------- tag query
def test_tagquery_routes_and_whitelist():
    eps = _paths(tagquery)
    assert ("GET", "/api/v1/orgs/{org}/sites/{site}/tag-history") in eps
    assert ("GET", "/api/v1/orgs/{org}/sites/{site}/tag-stats") in eps
    # read-only: aggregations come from a whitelist, never raw SQL from tenants
    assert tagquery.AGGS == frozenset({"raw", "min", "max", "avg"})


# ------------------------------------------------------------------- status
def test_status_is_public():
    from fastapi.params import Depends as DependsParam
    eps = _paths(statuspage)
    ep = eps[("GET", "/api/v1/status")]
    # public page: the endpoint must take NO auth dependency — a Depends
    # here would lock the status page behind sign-in.
    assert not any(isinstance(p.default, DependsParam)
                   for p in inspect.signature(ep).parameters.values())
