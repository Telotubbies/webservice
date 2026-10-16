"""Untrusted .glb inspection. The upload is parsed here — header, JSON chunk
only, never the binary — so the API can refuse hostile or broken files before
they are stored, and learn the node count for mapping validation.

Refused: wrong magic/version, oversized JSON, external resource URIs (a model
must be self-contained; the browser would otherwise fetch from anywhere), and
node graphs too big for a browser scene.
"""

from __future__ import annotations

import json
import struct

MAX_GLB_BYTES = 64 * 1024 * 1024
MAX_JSON_BYTES = 8 * 1024 * 1024
MAX_NODES = 60_000

_MAGIC = b"glTF"


class BadGlb(ValueError):
    """Message is safe to return to the client."""


def inspect(head: bytes) -> dict:
    """`head` = the file's leading bytes covering header + JSON chunk. Returns
    {"node_count", "mesh_count", "version"}."""
    if len(head) < 20 or head[:4] != _MAGIC:
        raise BadGlb("not a binary glTF (.glb) file")
    version, _total = struct.unpack_from("<II", head, 4)
    if version != 2:
        raise BadGlb("only glTF 2.0 is supported")
    jlen, jtype = struct.unpack_from("<II", head, 12)
    if jtype != 0x4E4F534A:  # 'JSON'
        raise BadGlb("first chunk is not JSON")
    if jlen > MAX_JSON_BYTES:
        raise BadGlb("model description too large")
    raw = head[20:20 + jlen]
    if len(raw) < jlen:
        raise BadGlb("truncated file")
    try:
        doc = json.loads(raw)
    except ValueError:
        raise BadGlb("invalid glTF JSON") from None
    if not isinstance(doc, dict):
        raise BadGlb("invalid glTF JSON")

    for coll in ("buffers", "images"):
        for item in doc.get(coll) or []:
            uri = item.get("uri") if isinstance(item, dict) else None
            if uri is not None and not str(uri).startswith("data:"):
                raise BadGlb("external resources are not allowed; embed them in the .glb")

    nodes = doc.get("nodes") or []
    if not isinstance(nodes, list) or len(nodes) > MAX_NODES:
        raise BadGlb("too many nodes")
    return {"version": version, "node_count": len(nodes),
            "mesh_count": len(doc.get("meshes") or [])}


def head_len(first_chunk: bytes) -> int:
    """Bytes needed from the start of the file to inspect it (header + JSON)."""
    if len(first_chunk) < 20 or first_chunk[:4] != _MAGIC:
        return 20
    jlen = struct.unpack_from("<I", first_chunk, 12)[0]
    return 20 + min(jlen, MAX_JSON_BYTES + 1)
