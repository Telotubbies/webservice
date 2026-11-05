"""Egress guard for tenant-configured outbound endpoints (notification
channels, outbound webhooks, external model endpoints).

SSRF policy: http(s) only, hostname must resolve, and EVERY resolved
address must be public — private/loopback/link-local/reserved/multicast
ranges (incl. the cloud-metadata 169.254.0.0/16 range) are refused.
`WDS_EGRESS_ALLOW_PRIVATE=1` opts out for dev/self-hosted installs where
webhooks legitimately point inside the LAN.

DNS is resolved at check time; a name that re-resolves to a private address
between check and connect (classic rebinding) is narrowed, not eliminated —
full protection needs an egress proxy. `post_no_redirect` additionally
prevents Authorization/signature headers leaking onto redirect targets and
blocks 30x-driven bounce into internal services.

Contract for callers:
    url = egress.check_url(body.url)                 # raises EgressError -> 422
    code = egress.post_no_redirect(url, body, hdrs)  # returns HTTP status
"""

from __future__ import annotations

import ipaddress
import logging
import os
import socket
import urllib.error
import urllib.request
from urllib.parse import urlsplit

log = logging.getLogger("wds.egress")


class EgressError(Exception):
    """URL violates egress policy — surface to the caller as a client error."""


def _allow_private() -> bool:
    return bool(os.environ.get("WDS_EGRESS_ALLOW_PRIVATE"))


def _resolve(host: str) -> list[str]:
    return [i[4][0] for i in socket.getaddrinfo(host, None)]


def _blocked(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    mapped = getattr(ip, "ipv4_mapped", None)       # IPv6Address only
    if mapped is not None:
        ip = mapped
    return (ip.is_private or ip.is_loopback or ip.is_link_local
            or ip.is_reserved or ip.is_multicast or ip.is_unspecified)


def check_url(url: str, *, https_only: bool = False, resolve: bool = True) -> str:
    """Validate an outbound URL. Returns it unchanged or raises EgressError."""
    try:
        u = urlsplit(url)
    except ValueError:
        raise EgressError("unparseable url") from None
    if u.scheme not in ("http", "https") or not u.hostname:
        raise EgressError("url must be http(s) with a host")
    if https_only and u.scheme != "https":
        raise EgressError("url must be https")
    if u.username or u.password:
        raise EgressError("credentials in url are not allowed")
    if not resolve:
        return url
    try:
        addrs = _resolve(u.hostname)
    except OSError:
        raise EgressError("host does not resolve") from None
    if not addrs:
        raise EgressError("host does not resolve")
    for a in addrs:
        try:
            ip = ipaddress.ip_address(a)
        except ValueError:
            raise EgressError("host does not resolve") from None
        if _blocked(ip) and not _allow_private():
            raise EgressError(f"host resolves to a non-public address ({ip})")
    return url


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None   # caller sees the 3xx code; headers never forwarded


_OPENER = urllib.request.build_opener(_NoRedirect)


def post_no_redirect(url: str, body: bytes, headers: dict[str, str],
                     timeout: float) -> int:
    """POST without following redirects. Returns the HTTP status code;
    transport errors propagate for the caller to classify."""
    req = urllib.request.Request(url, data=body, headers=headers)
    try:
        with _OPENER.open(req, timeout=timeout) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
