"""Vision detection events (roadmap 9.8): review, thumbnails and the MQTT
ingest handlers for the edge's vision/{event,audit,count} channels.

Trust boundary: org/site/edge come from the TOPIC (doc 17 §4); every payload
field is validated and bounded here before anything is stored. vision/audit
records are HMAC-signed by the edge with a key derived from its MQTT
credential (sha256 of the secret == the stored credential fingerprint) —
verification is fail-closed.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import io
import json
import logging
import math
import zipfile
from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from ..db import audit
from ..db.context import global_tx, tenant_tx
from ..db.util import iso_z, parse_ts, utcnow
from .classes import cloud_sig

log = logging.getLogger("wds.vision.events")

router = APIRouter()

KINDS = ("rule_fire", "blocked", "dry_run", "alert_object")
SEVERITIES = ("info", "warning", "critical")
MAX_EVENT_BYTES = 128 * 1024          # transport cap; thumb must decode to <= this
MAX_THUMB_BYTES = 128 * 1024
MAX_THUMB_B64 = 96 * 1024             # b64 of <=64KB binary, per the wire contract
MAX_AUDIT_BYTES = 16 * 1024
MAX_COUNT_BYTES = 16 * 1024
MAX_EVENTS_PAGE = 200
MAX_EXPORT_EVENTS = 500


def _m():
    from .. import main
    return main


async def _user(request: Request):
    return await _m().require_user(request)


# ------------------------------------------------------------ ingest parsing
def _num(v, lo: float, hi: float):
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    try:
        f = float(v)
    except OverflowError:
        return None
    return f if math.isfinite(f) and lo <= f <= hi else None


def _uuid(v):
    if not isinstance(v, str):
        return None
    try:
        return UUID(v)
    except ValueError:
        return None


def parse_event(raw: bytes) -> dict | None:
    """One vision/event message -> validated row dict, or None (drop)."""
    if len(raw) > MAX_EVENT_BYTES:
        return None
    try:
        doc = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(doc, dict):
        return None
    cam_id = _uuid(doc.get("camera_id"))
    kind = doc.get("kind")
    if cam_id is None or kind not in KINDS:
        return None
    class_id = doc.get("class_id")
    if class_id is not None and (isinstance(class_id, bool)
                                 or not isinstance(class_id, int) or not 0 <= class_id <= 9999):
        return None
    score = None
    if doc.get("score") is not None:
        score = _num(doc.get("score"), 0.0, 1.0)
        if score is None:
            return None
    bbox = doc.get("bbox")
    if bbox is not None:
        if not isinstance(bbox, (list, tuple)) or len(bbox) != 4 \
                or any(_num(v, -1.0, 2.0) is None for v in bbox):
            return None
        bbox = [float(v) for v in bbox]
    fired_at = doc.get("fired_at")
    try:
        fired = parse_ts(fired_at) if isinstance(fired_at, str) else utcnow()
    except (ValueError, TypeError):
        return None
    # a fired_at far in the future is a clock lie; far in the past is a replay
    age = (utcnow() - fired).total_seconds()
    if age < -120 or age > 7 * 86400:
        return None
    thumb = None
    b64 = doc.get("thumb_b64")
    if b64 is not None:
        if not isinstance(b64, str) or len(b64) > MAX_THUMB_B64:
            return None
        try:
            thumb = base64.b64decode(b64, validate=True)
        except (binascii.Error, ValueError):
            return None
        if len(thumb) > MAX_THUMB_BYTES or not thumb.startswith(b"\xff\xd8\xff"):
            return None                                # JPEG magic only
    sev = doc.get("severity")
    detail = doc.get("detail")
    return {"camera_id": cam_id, "rule_id": _uuid(doc.get("rule_id")),
            "kind": kind, "class_id": class_id, "score": score, "bbox": bbox,
            "model_version_id": _uuid(doc.get("model_version_id")),
            "thumb": thumb,
            "severity": sev if sev in SEVERITIES else None,
            "blocked_reason": (str(doc.get("blocked_reason"))[:200]
                               if isinstance(doc.get("blocked_reason"), str) else None),
            "detail": detail if isinstance(detail, dict) and
            len(json.dumps(detail)) <= 4096 else None,
            "fired_at": fired}


def _audit_message(rec: dict) -> bytes:
    """Canonical bytes the edge HMACs: every field except `sig`."""
    return json.dumps({k: v for k, v in rec.items() if k != "sig"},
                      sort_keys=True, separators=(",", ":")).encode()


def parse_audit(raw: bytes) -> dict | None:
    if len(raw) > MAX_AUDIT_BYTES:
        return None
    try:
        rec = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(rec, dict):
        return None
    if _uuid(rec.get("command_id")) is None or _uuid(rec.get("rule_id")) is None:
        return None
    if not isinstance(rec.get("tag_path"), str) or not 1 <= len(rec["tag_path"]) <= 200:
        return None
    v = rec.get("value")
    if not isinstance(v, (int, float, bool)) or (isinstance(v, float) and not math.isfinite(v)):
        return None
    try:
        fired = parse_ts(rec.get("fired_at"))
    except (ValueError, TypeError):
        return None
    sig = rec.get("sig")
    if not isinstance(sig, str) or not 64 <= len(sig) <= 128:
        return None
    rec["command_id"], rec["rule_id"] = str(_uuid(rec["command_id"])), str(_uuid(rec["rule_id"]))
    rec["fired_at"] = fired
    return rec


async def _edge_fingerprints(st, edge_id: UUID) -> list[bytes]:
    """All live credential fingerprints for this edge (active + grace) — an
    audit record signed under the OLD credential during its grace window is
    still verifiable."""
    async with global_tx(st.pools.system) as conn:
        rows = await conn.fetch(
            "SELECT fingerprint FROM edge_identities WHERE edge_id=$1"
            " AND status IN ('active','grace') AND fingerprint IS NOT NULL", edge_id)
    out = []
    for r in rows:
        try:
            out.append(bytes.fromhex(r["fingerprint"]))
        except (ValueError, TypeError):
            continue
    return out


async def handle_event(st, msg, edge) -> None:
    ev = parse_event(bytes(msg.payload))
    if ev is None or not await st.relay.owns(edge.id, ev["camera_id"]):
        return
    async with tenant_tx(st.pools.system, edge.org_id) as tc:
        await tc.execute(
            "INSERT INTO vision_events(org_id, camera_id, rule_id, kind, class_id, score,"
            " bbox, model_version_id, thumb, severity, blocked_reason, detail, fired_at)"
            " VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
            edge.org_id, ev["camera_id"], ev["rule_id"], ev["kind"], ev["class_id"],
            ev["score"], ev["bbox"], ev["model_version_id"], ev["thumb"], ev["severity"],
            ev["blocked_reason"], ev["detail"], ev["fired_at"])


async def handle_audit(st, msg, edge) -> None:
    """Edge-signed PLC-write audit record (9.7). Fail-closed: a record that
    does not verify against a live credential of THIS edge is dropped + logged."""
    rec = parse_audit(bytes(msg.payload))
    if rec is None:
        log.warning("malformed vision/audit dropped", extra={"edge_id": str(edge.id)})
        return
    keys = await _edge_fingerprints(st, edge.id)
    if not any(hmac.compare_digest(rec["sig"], hmac.new(k, _audit_message(rec),
                                                      hashlib.sha256).hexdigest())
               for k in keys):
        log.warning("vision/audit signature rejected", extra={"edge_id": str(edge.id)})
        return
    synced = utcnow()
    async with tenant_tx(st.pools.system, edge.org_id) as tc:
        await audit.append(
            tc, f"edge:{edge.id}", "command.edge_rule",
            {"command_id": rec["command_id"], "rule_id": rec["rule_id"],
             "tag_path": rec["tag_path"], "camera_id": rec.get("camera_id")},
            {"value": rec["value"], "source": "edge_rule",
             "fired_at": rec["fired_at"].isoformat(), "synced_at": synced.isoformat()})


async def handle_count(st, msg, edge) -> None:
    """Per-minute counts of non-alert classes (9.8). Live-state only: feeds the
    camera's minute counters; persisted metrics are a metrics-store decision."""
    raw = bytes(msg.payload)
    if len(raw) > MAX_COUNT_BYTES:
        return
    try:
        doc = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        return
    if not isinstance(doc, dict):
        return
    cam_id = _uuid(doc.get("camera_id"))
    if cam_id is None or not await st.relay.owns(edge.id, cam_id):
        return
    counts = doc.get("counts")
    if not isinstance(counts, dict):
        return
    clean = {}
    for k, v in list(counts.items())[:256]:
        if isinstance(k, str) and k.isdigit() and isinstance(v, int) \
                and not isinstance(v, bool) and 0 <= v <= 1_000_000:
            clean[int(k)] = v
    st.relay.note_count(cam_id, clean)


# ------------------------------------------------------------------- queries
def _event_json(r, review=None) -> dict:
    return {"id": str(r["id"]), "camera_id": str(r["camera_id"]),
            "rule_id": str(r["rule_id"]) if r["rule_id"] else None,
            "kind": r["kind"], "class_id": r["class_id"], "score": r["score"],
            "bbox": r["bbox"], "model_version_id": str(r["model_version_id"]) or None,
            "has_thumb": r["thumb"] is not None,
            "severity": r["severity"], "blocked_reason": r["blocked_reason"],
            "detail": r["detail"], "fired_at": iso_z(r["fired_at"]),
            "review": review}


_E = "/api/v1/orgs/{org}/vision/events"


@router.get(_E)
async def list_events(org: str, request: Request,
                      camera: str | None = None, class_id: int | None = None,
                      rule: str | None = None, kind: str | None = None,
                      outcome: Literal["reviewed", "unreviewed", "correct", "wrong"] | None = None,
                      since: str | None = None, until: str | None = None,
                      limit: int = Query(default=50, ge=1, le=MAX_EVENTS_PAGE),
                      cursor: str | None = None, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._READ)
    args: list = [org_id]
    where = ["e.org_id=$1"]
    if camera is not None:
        args.append(m._uuid_or_404(camera, "camera"))
        where.append(f"e.camera_id=${len(args)}")
    if class_id is not None:
        args.append(class_id)
        where.append(f"e.class_id=${len(args)}")
    if rule is not None:
        args.append(m._uuid_or_404(rule, "rule"))
        where.append(f"e.rule_id=${len(args)}")
    if kind is not None:
        if kind not in KINDS:
            raise HTTPException(422, "bad kind filter")
        args.append(kind)
        where.append(f"e.kind=${len(args)}")
    if outcome in ("correct", "wrong"):
        args.append(outcome)
        where.append(f"rv.verdict=${len(args)}")
    elif outcome == "reviewed":
        where.append("rv.verdict IS NOT NULL")
    elif outcome == "unreviewed":
        where.append("rv.verdict IS NULL")
    for name, val in (("since", since), ("until", until)):
        if val is not None:
            try:
                args.append(parse_ts(val))
            except (ValueError, TypeError):
                raise HTTPException(422, f"bad {name} timestamp") from None
            where.append(f"e.fired_at {'>=' if name == 'since' else '<='} ${len(args)}")
    anchor = None
    if cursor:
        anchor = _uuid(cursor)
    args.append(anchor)
    where.append(f"(${len(args)}::uuid IS NULL OR (e.fired_at, e.id) <"
                 " (SELECT fired_at, id FROM vision_events WHERE id=$%d))" % len(args))
    args.append(limit)
    sql = (
        "SELECT e.*, rv.verdict, rv.corrected_class_id FROM vision_events e"
        " LEFT JOIN vision_event_reviews rv ON rv.event_id=e.id"
        f" WHERE {' AND '.join(where)} ORDER BY e.fired_at DESC, e.id DESC LIMIT ${len(args)}")
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        rows = await tc.fetch(sql, *args)
    items = [_event_json(r, {"verdict": r["verdict"],
                             "corrected_class_id": r["corrected_class_id"]}
                        if r["verdict"] else None) for r in rows]
    return {"items": items, "next_cursor": items[-1]["id"] if len(items) == limit else None}


@router.get(_E + "/{event}")
async def get_event(org: str, event: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._READ)
    eid = m._uuid_or_404(event, "event")
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        r = await tc.fetchrow(
            "SELECT e.*, rv.verdict, rv.corrected_class_id FROM vision_events e"
            " LEFT JOIN vision_event_reviews rv ON rv.event_id=e.id WHERE e.id=$1", eid)
    if r is None:
        raise HTTPException(404, "event not found")
    return {"event": _event_json(r, {"verdict": r["verdict"],
                                     "corrected_class_id": r["corrected_class_id"]}
                                 if r["verdict"] else None)}


@router.get(_E + "/{event}/thumb")
async def event_thumb(org: str, event: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._READ)
    eid = m._uuid_or_404(event, "event")
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        thumb = await tc.fetchval("SELECT thumb FROM vision_events WHERE id=$1", eid)
    if thumb is None:
        raise HTTPException(404, "no thumbnail")
    return Response(bytes(thumb), media_type="image/jpeg",
                    headers={"Cache-Control": "private, max-age=300"})


class ReviewIn(BaseModel):
    verdict: Literal["correct", "wrong"]
    corrected_class_id: int | None = Field(default=None, ge=0, le=9999)


@router.post(_E + "/{event}/review")
async def review_event(org: str, event: str, body: ReviewIn, request: Request,
                       p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._OPERATE)
    eid = m._uuid_or_404(event, "event")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        ev = await tc.fetchval("SELECT 1 FROM vision_events WHERE id=$1", eid)
        if ev is None:
            raise HTTPException(404, "event not found")
        await tc.execute(
            "INSERT INTO vision_event_reviews(event_id, org_id, verdict, corrected_class_id,"
            " reviewed_by, reviewed_at) VALUES ($1,$2,$3,$4,$5,now())"
            " ON CONFLICT (event_id) DO UPDATE SET verdict=EXCLUDED.verdict,"
            " corrected_class_id=EXCLUDED.corrected_class_id, reviewed_by=EXCLUDED.reviewed_by,"
            " reviewed_at=now()",
            eid, org_id, body.verdict, body.corrected_class_id, p.user_id)
        await audit.append(tc, f"user:{p.user_id}", "vision.event.reviewed",
                           {"event_id": str(eid)}, {"verdict": body.verdict})
    return {"ok": True}


class BulkReviewIn(BaseModel):
    event_ids: list[UUID] = Field(min_length=1, max_length=200)
    verdict: Literal["correct", "wrong"]


@router.post(_E + "/bulk-review")
async def bulk_review(org: str, body: BulkReviewIn, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._OPERATE)
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        res = await tc.execute(
            "INSERT INTO vision_event_reviews(event_id, org_id, verdict, reviewed_by, reviewed_at)"
            " SELECT e.id, $2, $3, $4, now() FROM vision_events e WHERE e.id = ANY($1::uuid[])"
            " ON CONFLICT (event_id) DO UPDATE SET verdict=EXCLUDED.verdict,"
            " corrected_class_id=NULL, reviewed_by=EXCLUDED.reviewed_by, reviewed_at=now()",
            list(body.event_ids), org_id, body.verdict, p.user_id)
        await audit.append(tc, f"user:{p.user_id}", "vision.event.bulk_reviewed",
                           {}, {"verdict": body.verdict, "count": len(body.event_ids)})
    return {"ok": True, "updated": int(res.split()[-1])}


@router.get(_E + "/export.zip")
async def export_wrong(org: str, request: Request, camera: str | None = None,
                       p=Depends(_user)):
    """YOLO dataset ZIP of 'wrong'-reviewed events (9.8): images/*.jpg,
    labels/*.txt (class cx cy w h normalized) + classes.txt + data.yaml."""
    m = _m()
    org_id = m._v2_org(org, p, m._READ)
    cam_id = m._uuid_or_404(camera, "camera") if camera else None
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        rows = await tc.fetch(
            "SELECT e.id, e.class_id, e.bbox, e.thumb, rv.corrected_class_id,"
            " cm.class_config FROM vision_events e"
            " JOIN vision_event_reviews rv ON rv.event_id=e.id AND rv.verdict='wrong'"
            " LEFT JOIN camera_models cm ON cm.camera_id=e.camera_id"
            " WHERE e.thumb IS NOT NULL AND ($2::uuid IS NULL OR e.camera_id=$2)"
            " ORDER BY e.fired_at DESC LIMIT $1", MAX_EXPORT_EVENTS, cam_id)
    if not rows:
        raise HTTPException(404, "no reviewed-wrong events with thumbnails")
    # the corrected label set = every class id that appears, mapped densely 0..n-1
    class_ids = sorted({r["corrected_class_id"] for r in rows} | {r["class_id"] for r in rows})
    remap = {c: i for i, c in enumerate(class_ids)}
    names = {}
    for r in rows:
        for i, ent in ((r["class_config"] or {}).items() if isinstance(r["class_config"], dict) else []):
            try:
                names.setdefault(int(i), (ent.get("names") or {}).get("en") or f"class_{i}")
            except (ValueError, AttributeError):
                continue
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("classes.txt", "\n".join(names.get(c, f"class_{c}") for c in class_ids) + "\n")
        for r in rows:
            name = r["id"].hex
            z.writestr(f"images/{name}.jpg", bytes(r["thumb"]))
            label = r["corrected_class_id"] if r["corrected_class_id"] is not None else r["class_id"]
            bb = r["bbox"]
            if isinstance(bb, (list, tuple)) and len(bb) == 4 and label is not None:
                x, y, w, h = (float(v) for v in bb)
                z.writestr(f"labels/{name}.txt",
                           f"{remap[label]} {x + w / 2:.6f} {y + h / 2:.6f} {w:.6f} {h:.6f}\n")
        z.writestr("data.yaml", "nc: %d\nnames: [%s]\n" % (
            len(class_ids), ", ".join(names.get(c, f"class_{c}") for c in class_ids)))
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/zip", headers={
        "Content-Disposition": 'attachment; filename="vision-review-export.zip"'})


# ----------------------------------------------------- cloud inference path
@router.post("/api/v1/edge-cloud-infer/{camera}")
async def edge_cloud_infer(camera: str, edge: str, sig: str, request: Request):
    """Gateway -> cloud fallback inference (9.5). The signed URL (issued inside
    cfg like the model-download URLs) is the credential: any failure is a flat
    404/401, never an oracle. The frame is forwarded to the cloud model-server
    pool under the 9.10 contract and metered into inference_usage."""
    try:
        cam_id, edge_id = UUID(camera), UUID(edge)
    except ValueError:
        raise HTTPException(404, "not found") from None
    if not hmac.compare_digest(sig, cloud_sig(edge_id, cam_id)):
        raise HTTPException(401, "invalid signature")
    body = await request.body()
    if not body or len(body) > 150_000 or not body.startswith(b"\xff\xd8\xff"):
        raise HTTPException(422, "invalid_image")
    st = _m().st(request)
    async with global_tx(st.pools.system) as conn:
        cam = await conn.fetchrow(
            "SELECT id, org_id FROM cameras WHERE id=$1 AND edge_id=$2", cam_id, edge_id)
        pin = None
        if cam is not None:
            pin = await conn.fetchrow(
                "SELECT cm.model_version_id, cm.class_config FROM camera_models cm"
                " WHERE cm.camera_id=$1", cam_id)
    if cam is None or pin is None:
        raise HTTPException(404, "not found")
    async with tenant_tx(st.pools.system, cam["org_id"]) as tc:
        plan = await tc.fetchval(
            "SELECT plan_limits FROM organizations WHERE id=$1", cam["org_id"])
    if isinstance(plan, dict) and plan.get("cloud_infer") is False:
        raise HTTPException(403, "cloud_infer_not_in_plan")
    from . import cloud
    try:
        result = await cloud.infer(st, pin["model_version_id"], body,
                                   pin["class_config"] or {}, edge_id)
    except cloud.CloudInferError as e:
        raise HTTPException(502, str(e)[:80]) from None
    async with tenant_tx(st.pools.system, cam["org_id"]) as tc:
        await tc.execute(
            "INSERT INTO inference_usage(org_id, day, placement, frames, gpu_seconds)"
            " VALUES ($1, CURRENT_DATE, 'cloud', 1, $2)"
            " ON CONFLICT (org_id, day, placement) DO UPDATE SET"
            " frames = inference_usage.frames + 1,"
            " gpu_seconds = inference_usage.gpu_seconds + EXCLUDED.gpu_seconds,"
            " updated_at = now()", cam["org_id"], result["ms"] / 1000.0)
    return result
