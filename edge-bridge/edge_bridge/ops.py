"""Read-only operator ops requested over the command channel.

`test_source` and `browse` build a THROWAWAY adapter from the draft source in
the payload and close it afterwards. They never write to a PLC and never touch
the live adapter holder.
"""

from __future__ import annotations

import base64
import binascii
import logging
import time

import cv2
import numpy as np

from .adapters import make_source_adapter
from .adapters.base import Quality
from .vision.modelclient import ModelClient, ModelServerError

log = logging.getLogger("edge_bridge.ops")

OPS = ("test_source", "browse", "model_test")
SAMPLE_MAX = 5
DEADLINE_S = 9.0  # < the backend's 10 s wait


class OpError(Exception):
    """Op could not run; the message is the cmd-resp reason."""


def run(op: str, payload: dict, deadline_s: float = DEADLINE_S,
        model_server_url: str | None = None) -> dict:
    """Run an op with an overall deadline: past it the work stops, the
    throwaway adapter is closed and OpError("timeout") is raised."""
    deadline = time.monotonic() + deadline_s
    if op == "test_source":
        return test_source(payload, deadline)
    if op == "browse":
        return browse(payload, deadline)
    if op == "model_test":
        return model_test(payload, deadline, model_server_url)
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


# --------------------------------------------------------------- model_test
_MAX_IMAGE_B64 = 7 * 1024 * 1024          # ~5 MiB of image, base64-encoded
_JPEG, _PNG = b"\xff\xd8\xff", b"\x89PNG\r\n\x1a\n"


def model_test(payload: dict, deadline: float | None = None,
               model_server_url: str | None = None) -> dict:
    """One image through the model server: load (bounded wait), infer once, return
    {ms, engine, detections}. Every network call shares one absolute monotonic
    deadline — the backend is already waiting."""
    if not model_server_url:
        raise OpError("model_server_unavailable")
    model = payload.get("model")
    if not isinstance(model, dict) or not isinstance(model.get("version_id"), str):
        raise OpError("invalid_model")
    image_b64 = payload.get("image_b64")
    if not isinstance(image_b64, str) or not 0 < len(image_b64) <= _MAX_IMAGE_B64:
        raise OpError("invalid_image")
    try:
        image = base64.b64decode(image_b64, validate=True)
    except (binascii.Error, ValueError):
        raise OpError("invalid_image") from None
    if len(image) > 5 * 1024 * 1024:         # decoded cap — 7 MiB b64 admits >5 MiB
        raise OpError("invalid_image")
    if not (image.startswith(_JPEG) or image.startswith(_PNG)):
        raise OpError("invalid_image")
    if cv2.imdecode(np.frombuffer(image, np.uint8), cv2.IMREAD_COLOR) is None:
        raise OpError("invalid_image")
    if _expired(deadline):
        raise OpError("timeout")

    client = ModelClient(model_server_url, deadline=deadline)
    try:
        st = client.ensure(model)
        while st == "loading":             # bounded wait inside the shared budget
            left = (deadline - time.monotonic()) if deadline is not None else 1.0
            if left <= 0:
                raise OpError("timeout")
            time.sleep(min(0.25, left))
            st = client.ensure(model)      # each inner call is bounded by the deadline
        if _expired(deadline):
            raise OpError("timeout")
        if st.startswith("failed:"):
            raise OpError(st[len("failed:")][:200] or "load_failed")
        dets, ms = client.infer(model["version_id"], image, [], 0.05)
        if _expired(deadline):
            raise OpError("timeout")
        engine = client.engine(model["version_id"])
        # engine() swallows ModelServerError (returns None) — check the budget
        # ourselves so a timed-out engine call still reports 'timeout'.
        if _expired(deadline):
            raise OpError("timeout")
    except ModelServerError as exc:
        raise OpError(str(exc)) from None
    return {"ms": ms, "engine": engine, "detections": dets}
