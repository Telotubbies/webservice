"""Edge consumes backend-pushed cfg: apply, ack, stale/retained, cache."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "edge-bridge"))

from edge_bridge.adapters import make_adapter  # noqa: E402
from edge_bridge.cfg import AdapterHolder, CfgClient  # noqa: E402
from edge_bridge.commands import CommandHandler  # noqa: E402
from edge_bridge.config import Config  # noqa: E402


class FakeBridge:
    def __init__(self):
        self.pub: list[tuple[str, dict]] = []
        self.subs: list[str] = []

    def publish_json(self, topic, payload, qos=1):
        self.pub.append((topic, payload))
        return True

    def subscribe(self, topic, qos=1):
        self.subs.append(topic)


def sim_source(sid="src1", paths=("a/b/c/x",), enabled=True, poll_ms=500,
               protocol="sim"):
    return {"id": sid, "protocol": protocol, "connection": {}, "secrets": None,
            "poll_ms": poll_ms, "enabled": enabled,
            "tags": [{"id": f"t-{p}", "path": p, "type": "float",
                      "address": {"behavior": "random_walk", "initial": 1.0},
                      "scale": 1.0, "offset": 0.0, "writable": True,
                      "min": None, "max": None} for p in paths]}


def msg(version, sources, retain=False):
    return SimpleNamespace(topic="v2/o/s/e/cfg", retain=retain,
                           payload=json.dumps({"version": version,
                                               "sources": sources}).encode())


def make(tmp_path):
    cfg = Config(org_id="o", site_id="s", edge_id="e", site_code="plant1",
                 state_dir=str(tmp_path))
    holder = AdapterHolder(make_adapter("sim", "plant1", {}), poll_ms=1000)
    bridge = FakeBridge()
    return cfg, holder, bridge, CfgClient(cfg, holder, bridge, "plant1")


def acks(bridge):
    return [p for t, p in bridge.pub if t.endswith("/cfg-ack")]


def test_apply_then_ack(tmp_path):
    cfg, holder, bridge, cl = make(tmp_path)
    cl.handle(msg(3, [sim_source()]))
    assert acks(bridge) == [{"version": 3, "ok": True, "errors": []}]
    assert bridge.pub[-1][0] == "v2/o/s/e/cfg-ack"
    assert set(holder.get().tag_map()) == {"plant1.a.b.c.x"}
    assert holder.poll_ms == 500
    assert (tmp_path / "cfg.json").exists()


def test_connect_requests_cfg(tmp_path):
    cfg, holder, bridge, cl = make(tmp_path)
    cl.on_connect(bridge)
    assert bridge.subs == ["v2/o/s/e/cfg"]
    assert bridge.pub[-1] == ("v2/o/s/e/cfg-req", {"have_version": None})
    cl.handle(msg(2, [sim_source()]))
    cl.on_connect(bridge)
    assert bridge.pub[-1][1] == {"have_version": 2}


def test_stale_cfg_ignored(tmp_path):
    cfg, holder, bridge, cl = make(tmp_path)
    cl.handle(msg(5, [sim_source(paths=("a/b/c/x",))]))
    n = len(bridge.pub)
    cl.handle(msg(5, [sim_source(paths=("a/b/c/y",))]))
    cl.handle(msg(4, [sim_source(paths=("a/b/c/y",))]))
    assert len(bridge.pub) == n
    assert set(holder.get().tag_map()) == {"plant1.a.b.c.x"}


def test_version_zero_does_not_stop_yaml_edge(tmp_path):
    cfg, holder, bridge, cl = make(tmp_path)
    before = holder.get()
    cl.handle(msg(0, []))
    assert holder.get() is before
    assert bridge.pub == []


def test_retained_cfg_ignored(tmp_path):
    cfg, holder, bridge, cl = make(tmp_path)
    before = holder.get()
    cl.handle(msg(7, [sim_source()], retain=True))
    assert holder.get() is before
    assert bridge.pub == []


def test_bad_source_isolated(tmp_path):
    cfg, holder, bridge, cl = make(tmp_path)
    cl.handle(msg(1, [sim_source("good", ("a/b/c/x",))]))
    bad = sim_source("bad", ("a/b/c/z",), protocol="nope")
    cl.handle(msg(2, [sim_source("good", ("a/b/c/x", "a/b/c/w")), bad]))
    ack = acks(bridge)[-1]
    assert ack["version"] == 2 and ack["ok"] is False
    assert [e["source_id"] for e in ack["errors"]] == ["bad"]
    assert set(holder.get().tag_map()) == {"plant1.a.b.c.x", "plant1.a.b.c.w"}


def test_failed_source_keeps_previous_adapter(tmp_path):
    cfg, holder, bridge, cl = make(tmp_path)
    cl.handle(msg(1, [sim_source("s1", ("a/b/c/x",))]))
    cl.handle(msg(2, [sim_source("s1", ("a/b/c/y",), protocol="nope")]))
    assert acks(bridge)[-1]["ok"] is False
    assert set(holder.get().tag_map()) == {"plant1.a.b.c.x"}
    assert holder.get().read_all()  # previous adapter still alive


def test_disabled_source_dropped_and_poll_min(tmp_path):
    cfg, holder, bridge, cl = make(tmp_path)
    cl.handle(msg(1, [sim_source("a", ("a/b/c/x",), poll_ms=800),
                      sim_source("b", ("a/b/c/y",), poll_ms=200),
                      sim_source("c", ("a/b/c/z",), poll_ms=50, enabled=False)]))
    assert holder.poll_ms == 200
    assert set(holder.get().tag_map()) == {"plant1.a.b.c.x", "plant1.a.b.c.y"}
    cl.handle(msg(2, []))
    assert holder.poll_ms == 1000  # default when no enabled sources


def test_cached_cfg_loaded_on_start(tmp_path):
    cfg, holder, bridge, cl = make(tmp_path)
    cl.handle(msg(4, [sim_source()]))
    holder2 = AdapterHolder(make_adapter("sim", "plant1", {}), poll_ms=1000)
    bridge2 = FakeBridge()
    cl2 = CfgClient(cfg, holder2, bridge2, "plant1")
    assert cl2.load_cached() is True
    assert set(holder2.get().tag_map()) == {"plant1.a.b.c.x"}
    assert bridge2.pub == []
    assert cl2.version == 4
    cl2.on_connect(bridge2)
    assert bridge2.pub[-1][1] == {"have_version": 4}


def test_no_or_corrupt_cache_falls_back(tmp_path):
    cfg, holder, bridge, cl = make(tmp_path)
    assert cl.load_cached() is False
    (tmp_path / "cfg.json").write_text("{not json")
    assert cl.load_cached() is False
    assert cl.version is None


def test_command_write_routes_through_holder(tmp_path):
    cfg, holder, bridge, cl = make(tmp_path)
    clock = SimpleNamespace(clock_ok=True, now=lambda: datetime.now(timezone.utc))
    handler = CommandHandler(cfg, holder, clock, bridge)
    src = sim_source()
    src["tags"][0]["address"]["behavior"] = "state"
    cl.handle(msg(1, [src]))
    m = SimpleNamespace(topic="v2/o/s/e/cmd/r1", retain=False,
                        payload=json.dumps({"tag_path": "a/b/c/x", "value": 3.0,
                                            "issued_at": clock.now().isoformat()
                                            }).encode())
    handler.handle_message(m)
    resp = [p for t, p in bridge.pub if "cmd-resp" in t][-1]
    assert resp["status"] == "acknowledged"
