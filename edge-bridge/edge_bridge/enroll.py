"""First-start enrollment: exchange a one-time code for the gateway identity.

If ENROLL_CODE and WDS_URL are set and ``state_dir/identity.json`` does not
exist, POST ``{WDS_URL}/api/v1/edge/enroll`` and persist the answer (0600)
together with the broker CA (``ca.pem``). Once identity.json exists the code
is never sent again, so a restart (or a stale ENROLL_CODE left in the
container env) is harmless. Failures raise EnrollError: the caller logs and
exits non-zero and the container restart policy retries.
"""

from __future__ import annotations

import json
import logging
import os
import ssl
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

log = logging.getLogger("edge_bridge.enroll")

IDENTITY_NAME = "identity.json"
CA_NAME = "ca.pem"
_FIELDS = ("org_id", "site_id", "edge_id", "mqtt_host", "mqtt_port",
           "mqtt_username", "mqtt_password", "state_key")


class EnrollError(RuntimeError):
    pass


def load_identity(state_dir: str) -> dict | None:
    """The persisted identity, or None when this gateway is not enrolled."""
    try:
        doc = json.loads((Path(state_dir) / IDENTITY_NAME).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except (OSError, ValueError) as exc:
        raise EnrollError(f"identity.json unreadable: {exc}") from exc
    if not isinstance(doc, dict) or not all(doc.get(k) not in (None, "") for k in
                                            ("org_id", "site_id", "edge_id")):
        raise EnrollError("identity.json is malformed")
    return doc


def _write_private(path: Path, data: bytes) -> None:
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        try:
            os.chmod(tmp, 0o600)
        except OSError:
            pass  # best effort (Windows)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _post(url: str, code: str, insecure: bool, timeout: float) -> dict:
    req = urllib.request.Request(
        url, data=json.dumps({"code": code}).encode(), method="POST",
        headers={"Content-Type": "application/json"})
    ctx = None
    if url.lower().startswith("https"):
        ctx = ssl.create_default_context()
        if insecure:
            log.warning("WDS_INSECURE_TLS=1 — TLS verification disabled (dev only)")
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:  # noqa: S310
            return json.loads(r.read())
    except urllib.error.HTTPError as exc:
        reason = {404: "unknown enrollment code", 410: "enrollment code already used, "
                  "expired, or the device is disabled — issue a new code in the UI",
                  429: "too many attempts — slow down"}.get(exc.code, f"HTTP {exc.code}")
        raise EnrollError(f"enroll rejected by {url}: {reason}") from exc
    except (urllib.error.URLError, OSError, ValueError) as exc:
        raise EnrollError(f"enroll request to {url} failed: {exc}") from exc


def enroll_if_needed(state_dir: str, env=None, timeout: float = 15.0) -> dict | None:
    """Enroll when configured and not yet enrolled. Returns the identity in
    force (new or existing), or None when running on plain env config."""
    env = os.environ if env is None else env
    existing = load_identity(state_dir)
    if existing is not None:
        return existing
    code, url = (env.get("ENROLL_CODE") or "").strip(), (env.get("WDS_URL") or "").strip()
    if not code or not url:
        return None
    endpoint = url.rstrip("/") + "/api/v1/edge/enroll"
    log.info("enrolling with %s", url)
    doc = _post(endpoint, code, env.get("WDS_INSECURE_TLS") == "1", timeout)
    missing = [k for k in _FIELDS if doc.get(k) in (None, "")]
    if missing:
        raise EnrollError(f"enroll response missing {missing}")
    d = Path(state_dir)
    d.mkdir(parents=True, exist_ok=True)
    ident = {k: doc[k] for k in _FIELDS}
    ca = doc.get("ca_pem") or ""
    if ca:
        _write_private(d / CA_NAME, ca.encode())
        ident["mqtt_ca_file"] = str(d / CA_NAME)
    # identity last: its presence is the "enrolled" marker, so a crash between
    # the two writes re-enrolls rather than leaving a half identity
    _write_private(d / IDENTITY_NAME, json.dumps(ident).encode())
    log.info("enrolled as edge %s", ident["edge_id"])
    return ident
