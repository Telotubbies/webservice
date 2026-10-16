"""Environment-driven configuration (contract §Env vars + doc 17 §1/§5).

Two different "site/edge" spellings exist on purpose:

* ``site_code`` (``SITE``, e.g. ``plant1``) — human tag naming; adapters key
  tags as ``{site_code}.{area}.{line}.{device}.{signal}``.
* ``org_id``/``site_id``/``edge_id`` — UUIDs that form the doc-17 MQTT
  namespace ``v2/{org}/{site}/{edge}/...``. Topic identity is UUIDs only.

Credentials are provisioned, never shared: the edge reads its broker
username/password from files (``MQTT_USERNAME_FILE`` / ``MQTT_PASSWORD_FILE``,
falling back to env for local dev) and re-reads them on every connect
attempt so a rotated credential takes effect at the next reconnect.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, replace
from pathlib import Path


def _file_or_none(path: str | None) -> str | None:
    if not path:
        return None
    try:
        v = Path(path).read_text().strip()
        return v or None
    except OSError:
        return None


@dataclass(frozen=True)
class Config:
    mqtt_host: str = "localhost"
    mqtt_port: int = 8883                      # TLS listener (doc 17 §2)
    mqtt_user: str | None = None               # edge-{edge_id}-v{n}
    mqtt_password: str | None = None
    mqtt_user_file: str | None = None
    mqtt_password_file: str | None = None
    mqtt_ca_file: str | None = None            # dev CA from infra/gen-certs.sh
    org_id: str = ""
    site_id: str = ""
    edge_id: str = ""                          # UUID — the doc-17 identity
    site_code: str = "plant1"                  # tag naming prefix only
    adapter: str = "sim"
    poll_ms: int = 1000
    clock_skew_ms: float = 0.0
    tags_config: str = "tags.yaml"
    heartbeat_s: float = 5.0          # contract: heartbeat every 5 s
    clock_ok_threshold_ms: float = 500.0
    state_dir: str = "/var/lib/wds-edge"       # applied-cfg cache (cfg.json)
    state_key: str | None = None               # from enrollment; seals the cfg cache
    identity_file: str | None = None           # set when running from enrollment

    @classmethod
    def from_env(cls, identity: dict | None = None) -> "Config":
        """``identity`` (enroll.py's identity.json) wins over env for ids,
        broker address, credentials and CA."""
        c = cls._from_env()
        if not identity:
            return c
        return replace(
            c, org_id=identity["org_id"], site_id=identity["site_id"],
            edge_id=identity["edge_id"],
            mqtt_host=identity.get("mqtt_host") or c.mqtt_host,
            mqtt_port=int(identity.get("mqtt_port") or c.mqtt_port),
            mqtt_user=identity.get("mqtt_username") or c.mqtt_user,
            mqtt_password=identity.get("mqtt_password") or c.mqtt_password,
            mqtt_user_file=None, mqtt_password_file=None,
            mqtt_ca_file=identity.get("mqtt_ca_file") or c.mqtt_ca_file,
            state_key=identity.get("state_key") or None,
            identity_file=str(Path(c.state_dir) / "identity.json"))

    @classmethod
    def _from_env(cls) -> "Config":
        return cls(
            mqtt_host=os.getenv("MQTT_HOST", "localhost"),
            mqtt_port=int(os.getenv("MQTT_PORT", "8883")),
            mqtt_user=os.getenv("MQTT_USER") or None,
            mqtt_password=os.getenv("MQTT_PASSWORD") or None,
            mqtt_user_file=os.getenv("MQTT_USERNAME_FILE") or None,
            mqtt_password_file=os.getenv("MQTT_PASSWORD_FILE") or None,
            mqtt_ca_file=os.getenv("MQTT_CA_FILE") or None,
            org_id=os.getenv("ORG_ID", ""),
            site_id=os.getenv("SITE_ID", ""),
            edge_id=os.getenv("EDGE_ID", ""),
            site_code=os.getenv("SITE", "plant1"),
            adapter=os.getenv("ADAPTER", "sim"),
            poll_ms=int(os.getenv("POLL_MS", "1000")),
            clock_skew_ms=float(os.getenv("EDGE_CLOCK_SKEW_MS", "0")),
            tags_config=os.getenv("TAGS_CONFIG", "tags.yaml"),
            state_dir=os.getenv("STATE_DIR", "/var/lib/wds-edge"),
        )

    # -- doc 17 topic helpers -------------------------------------------------
    @property
    def prefix(self) -> str:
        return f"v2/{self.org_id}/{self.site_id}/{self.edge_id}"

    @property
    def hb_topic(self) -> str:
        return f"{self.prefix}/hb"

    @property
    def cmd_topic(self) -> str:
        return f"{self.prefix}/cmd/+"

    @property
    def enrolled(self) -> bool:
        return self.identity_file is not None

    @property
    def cred_topic(self) -> str:
        return f"{self.prefix}/cred"

    @property
    def cfg_topic(self) -> str:
        return f"{self.prefix}/cfg"

    @property
    def cfg_req_topic(self) -> str:
        return f"{self.prefix}/cfg-req"

    @property
    def cfg_ack_topic(self) -> str:
        return f"{self.prefix}/cfg-ack"

    def vision_frame_topic(self, camera_id: str) -> str:
        return f"{self.prefix}/vision/frame/{camera_id}"

    @property
    def vision_stat_topic(self) -> str:
        return f"{self.prefix}/vision/stat"

    def tele_topic(self, tag_path: str) -> str:
        """tag_path is the site-relative path (area/line/device/signal)."""
        return f"{self.prefix}/tele/{tag_path}"

    def cmd_resp_topic(self, command_id: str) -> str:
        return f"{self.prefix}/cmd-resp/{command_id}"

    def tag_path(self, full_name: str) -> str:
        """'{site_code}.a.b.c' -> 'a/b/c' — the v2 tele topic tail."""
        name = full_name
        prefix = f"{self.site_code}."
        if name.startswith(prefix):
            name = name[len(prefix):]
        return name.replace(".", "/")

    def credentials(self) -> tuple[str | None, str | None]:
        """Current (username, password); files re-read so a rotated secret
        is picked up on the next connect attempt (doc 17 §5)."""
        if self.identity_file:
            # enrolled: identity.json is the live source (in-band rotation
            # rewrites it); fall back to the values captured at startup
            try:
                ident = json.loads(Path(self.identity_file).read_text(encoding="utf-8"))
                return ident.get("mqtt_username") or self.mqtt_user, \
                    ident.get("mqtt_password") or self.mqtt_password
            except (OSError, ValueError):
                return self.mqtt_user, self.mqtt_password
        user = _file_or_none(self.mqtt_user_file) or self.mqtt_user
        pw = _file_or_none(self.mqtt_password_file) or self.mqtt_password
        return user, pw
