"""In-band credential delivery to enrolled gateways.

After an operator rotates an edge credential, the new secret is published
(QoS1, NOT retained) on `v2/{org}/{site}/{edge}/cred`. Only that edge's role
may subscribe (ACL in dynsec.edge_acls) and the message is addressed to the
old, still-valid credential during its grace window. The payload carries a
secret, so it is never logged.
"""

from __future__ import annotations

from .mqtt_client import cred_topic


def cred_payload(version: int, username: str, password: str) -> dict:
    return {"version": int(version), "username": username, "password": password}


def push_cred(mqtt, org_id, site_id, edge_id, version: int, username: str,
              password: str) -> bool:
    return bool(mqtt.publish_cred(cred_topic(org_id, site_id, edge_id),
                                  cred_payload(version, username, password)))
