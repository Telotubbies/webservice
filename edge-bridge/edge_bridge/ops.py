"""Read-only operator ops requested over the command channel.

`test_source` and `browse` build a THROWAWAY adapter from the draft source in
the payload and close it afterwards. They never write to a PLC and never touch
the live adapter holder.
"""

from __future__ import annotations

import logging
import time

from .adapters import make_source_adapter
from .adapters.base import Quality

log = logging.getLogger("edge_bridge.ops")

OPS = ("test_source", "browse")
SAMPLE_MAX = 5
DEADLINE_S = 9.0  # < the backend's 10 s wait


class OpError(Exception):
    """Op could not run; the message is the cmd-resp reason."""


def run(op: str, payload: dict, deadline_s: float = DEADLINE_S) -> dict:
    """Run an op with an overall deadline: past it the work stops, the
    throwaway adapter is closed and OpError("timeout") is raised."""
    deadline = time.monotonic() + deadline_s
    if op == "test_source":
        return test_source(payload, deadline)
    if op == "browse":
        return browse(payload, deadline)
    raise OpError(f"unknown_op:{op}")


def _build(source: object, deadline: float | None = None):
    if not isinstance(source, dict):
        raise OpError("invalid_source")
    try:
        ad = make_source_adapter(source, "test")
    except (ValueError, KeyError, TypeError) as exc:
        raise OpError(f"invalid_source:{exc}") from None
    ad.deadline = deadline  # adapters that honour it stop work past it
    return ad


def _expired(deadline: float | None) -> bool:
    return deadline is not None and time.monotonic() >= deadline


def test_source(payload: dict, deadline: float | None = None) -> dict:
    source = payload.get("source")
    try:
        ad = _build(source, deadline)
    except OpError as exc:
        return {"ok": False, "detail": str(exc), "sample": []}
    try:
        try:
            if not ad.tag_map() and source.get("protocol") == "opcua":
                # connectivity-only probe: listing the Objects folder proves
                # session + read access without needing any tag
                ad.browse(None)
                if _expired(deadline):
                    raise OpError("timeout")
                return {"ok": True, "detail": "connected", "sample": []}
            values = ad.read_all()
        except OpError:
            raise
        except TimeoutError:
            raise OpError("timeout") from None
        except Exception as exc:  # noqa: BLE001 - detail goes back to the operator
            if _expired(deadline):
                raise OpError("timeout") from None
            return {"ok": False, "detail": _detail(ad, exc), "sample": []}
        if _expired(deadline):
            raise OpError("timeout")
    finally:
        try:
            ad.close()
        except Exception:  # noqa: BLE001
            log.debug("closing test adapter failed", exc_info=True)
    if not values:
        return {"ok": False, "detail": "no_tags_to_test", "sample": []}
    prefix = "test."
    sample = [{"path": v.name[len(prefix):].replace(".", "/") if v.name.startswith(prefix)
               else v.name, "v": v.v, "q": v.q.value} for v in values[:SAMPLE_MAX]]
    good = sum(1 for v in values if v.q is Quality.GOOD)
    if good == 0:
        return {"ok": False, "detail": getattr(ad, "last_error", None) or "all_reads_bad",
                "sample": sample}
    return {"ok": True, "detail": f"{good}/{len(values)} tags read good", "sample": sample}


def browse(payload: dict, deadline: float | None = None) -> dict:
    source = payload.get("source")
    if not isinstance(source, dict) or source.get("protocol") != "opcua":
        raise OpError("browse_requires_opcua")
    node_id = payload.get("node_id")
    if node_id is not None and not isinstance(node_id, str):
        raise OpError("invalid_node_id")
    ad = _build({**source, "tags": []}, deadline)
    try:
        items = ad.browse(node_id)
        if _expired(deadline):
            raise OpError("timeout")
        return {"items": items}
    except OpError:
        raise
    except TimeoutError:
        raise OpError("timeout") from None
    except Exception as exc:  # noqa: BLE001
        if _expired(deadline):
            raise OpError("timeout") from None
        raise OpError(_detail(ad, exc)) from None
    finally:
        try:
            ad.close()
        except Exception:  # noqa: BLE001
            log.debug("closing browse adapter failed", exc_info=True)


def _detail(ad, exc: Exception) -> str:
    return getattr(ad, "last_error", None) or f"{type(exc).__name__}: {exc}"
