"""Outbox dispatcher (F18): signs and POSTs due rows, retries with backoff, dead-letters.

Signature (docs/security-design.md 5.2):  X-Vissointan-Signature: t=<unix>,v1=<hex>
with v1 = HMAC-SHA256(secret, t + "." + raw_body). The receiver rejects |now-t| > 300 s
and dedups on Idempotency-Key / X-Vissointan-Event-Id.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import random
import time

from ..core import config, egress
from ..datasources import secretbox
from ..db.context import active_org_ids, tenant_tx

log = logging.getLogger("wds.integration.dispatch")

BACKOFF_S = (30, 120, 600, 3600, 21600)       # then 6 h until MAX_ATTEMPTS
MAX_ATTEMPTS = 8


def sign(secret: str, body: bytes, t: int) -> str:
    v1 = hmac.new(secret.encode(), str(t).encode() + b"." + body, hashlib.sha256).hexdigest()
    return f"t={t},v1={v1}"


def verify(secret: str, body: bytes, header: str, now: int | None = None, tolerance: int = 300) -> bool:
    """What a receiver does. Constant-time compare, replay window enforced."""
    try:
        parts = dict(p.split("=", 1) for p in header.split(","))
        t = int(parts["t"])
    except (ValueError, KeyError):
        return False
    if abs((now if now is not None else int(time.time())) - t) > tolerance:
        return False
    return hmac.compare_digest(sign(secret, body, t), header)


def next_delay(attempts: int) -> float:
    base = BACKOFF_S[min(attempts - 1, len(BACKOFF_S) - 1)]
    return base * random.uniform(0.9, 1.1)


def classify(code: int) -> str:
    """ok | retry | dead for an HTTP status."""
    if 200 <= code < 300:
        return "ok"
    if 400 <= code < 500 and code not in (408, 429):
        return "dead"                        # data or mapping is wrong; retrying will not help
    return "retry"


async def _send(row, ep) -> tuple[str, int | None, str | None]:
    body = json.dumps(row["payload"] if isinstance(row["payload"], dict) else json.loads(row["payload"]),
                      separators=(",", ":"), default=str).encode()
    secret = secretbox.open_(bytes(ep["secret_enc"]))["secret"]
    headers = {"Content-Type": "application/json",
               "X-Vissointan-Signature": sign(secret, body, int(time.time())),
               "X-Vissointan-Event-Id": str(row["id"]),
               "Idempotency-Key": row["idempotency_key"],
               "User-Agent": "vissointan-webhook/1.0"}
    try:
        egress.check_url(ep["url"], https_only=True)
        code = await asyncio.get_running_loop().run_in_executor(
            None, lambda: egress.post_no_redirect(ep["url"], body, headers, timeout=config.WEBHOOK_TIMEOUT_S))
    except egress.EgressError as exc:
        return "dead", None, f"egress refused: {exc}"          # SSRF block: never retried
    except Exception as exc:  # noqa: BLE001 - network error: retry
        return "retry", None, str(exc)[:500]
    return classify(code), code, None if classify(code) == "ok" else f"http {code}"


async def dispatch_due(pools, batch: int = 50) -> int:
    """One pass over every live org. Returns rows attempted."""
    done = 0
    for org_id in await active_org_ids(pools.system):
        try:
            async with tenant_tx(pools.system, org_id) as tc:
                rows = await tc.fetch(
                    "SELECT o.*, e.url, e.secret_enc, e.enabled FROM integration_outbox o"
                    " LEFT JOIN webhook_endpoints e ON e.org_id = o.org_id AND e.id = o.connection_id"
                    " WHERE o.status='pending' AND o.next_try_at <= now()"
                    " ORDER BY o.id LIMIT $1 FOR UPDATE OF o SKIP LOCKED", batch)
                for r in rows:
                    if r["url"] is None or not r["enabled"]:
                        verdict, code, err = "dead", None, "endpoint removed or disabled"
                    else:
                        verdict, code, err = await _send(r, r)
                    attempts = r["attempts"] + 1
                    if verdict == "retry" and attempts >= MAX_ATTEMPTS:
                        verdict = "dead"
                    if verdict == "ok":
                        await tc.execute("UPDATE integration_outbox SET status='sent', attempts=$2, last_code=$3,"
                                         " last_error=NULL, sent_at=now() WHERE id=$1", r["id"], attempts, code)
                    elif verdict == "dead":
                        await tc.execute("UPDATE integration_outbox SET status='dead', attempts=$2, last_code=$3,"
                                         " last_error=$4 WHERE id=$1", r["id"], attempts, code, err)
                    else:
                        await tc.execute(
                            "UPDATE integration_outbox SET attempts=$2, last_code=$3, last_error=$4,"
                            " next_try_at = now() + make_interval(secs => $5) WHERE id=$1",
                            r["id"], attempts, code, err, next_delay(attempts))
                    done += 1
        except Exception:  # noqa: BLE001 - one org must not stop the pass
            log.exception("outbox dispatch failed", extra={"org_id": str(org_id)})
    return done
