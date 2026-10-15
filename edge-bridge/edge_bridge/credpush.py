"""Adopt a credential pushed by the backend on `v2/{o}/{s}/{e}/cred`.

Only enrolled gateways (identity.json) act on it. The message must be live
(not retained), well-formed, and newer than the credential in force; then
identity.json is rewritten atomically and the MQTT session is dropped so the
supervisor reconnects with the new secret (Config.credentials() re-reads
identity.json on every attempt). Payloads hold a secret and are never logged.
"""

from __future__ import annotations

import json
import logging
from typing import Callable

from .config import Config
from .enroll import EnrollError, credential_version, load_identity, update_credentials

log = logging.getLogger("edge_bridge.cred")


class CredClient:
    def __init__(self, cfg: Config, reconnect: Callable[[], None]):
        self._cfg = cfg
        self._reconnect = reconnect

    def handle(self, msg) -> bool:
        """True when a newer credential was adopted."""
        if getattr(msg, "retain", False):
            log.warning("ignored retained cred message")
            return False
        try:
            doc = json.loads(msg.payload)
            version, user, pw = doc["version"], doc["username"], doc["password"]
            if (not isinstance(doc, dict) or isinstance(version, bool)
                    or not isinstance(version, int)
                    or not isinstance(user, str) or not user
                    or not isinstance(pw, str) or not pw):
                raise ValueError("malformed")
        except (ValueError, KeyError, TypeError, UnicodeDecodeError):
            log.warning("ignored malformed cred message")
            return False
        try:
            ident = load_identity(self._cfg.state_dir)
            if ident is None or version <= credential_version(ident):
                log.info("ignored cred version=%s (not newer)", version)
                return False
            update_credentials(self._cfg.state_dir, version, user, pw)
        except (EnrollError, OSError):
            log.exception("could not store rotated credential")
            return False
        log.info("adopted rotated credential version=%s — reconnecting", version)
        self._reconnect()
        return True
