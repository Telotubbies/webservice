"""Plant-model .glb inspection (pure): what the upload endpoint accepts."""

from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from app.plant import glb
from app.plant.kinds import KINDS


def make_glb(doc: dict | None = None, *, version: int = 2, magic: bytes = b"glTF") -> bytes:
    body = json.dumps(doc if doc is not None else {"asset": {"version": "2.0"}}).encode()
    body += b" " * (-len(body) % 4)
    chunk = struct.pack("<II", len(body), 0x4E4F534A) + body
    return magic + struct.pack("<II", version, 12 + len(chunk)) + chunk


def test_minimal_glb_ok():
    info = glb.inspect(make_glb({"asset": {"version": "2.0"}, "nodes": [{}, {}], "meshes": [{}]}))
    assert info == {"version": 2, "node_count": 2, "mesh_count": 1}


@pytest.mark.parametrize("data", [b"", b"MZ" * 20, make_glb(magic=b"GLTF"), make_glb(version=1)])
def test_rejects_non_glb(data):
    with pytest.raises(glb.BadGlb):
        glb.inspect(data)


def test_rejects_external_uris():
    for doc in ({"buffers": [{"uri": "http://evil/x.bin", "byteLength": 1}]},
                {"images": [{"uri": "../../etc/passwd"}]}):
        with pytest.raises(glb.BadGlb, match="external"):
            glb.inspect(make_glb(doc))


def test_data_uris_are_fine():
    glb.inspect(make_glb({"images": [{"uri": "data:image/png;base64,AAAA"}]}))


def test_rejects_too_many_nodes():
    with pytest.raises(glb.BadGlb, match="too many"):
        glb.inspect(make_glb({"nodes": [{}] * (glb.MAX_NODES + 1)}))


def test_truncated_json_chunk():
    data = make_glb({"nodes": [{}] * 50})
    with pytest.raises(glb.BadGlb, match="truncated"):
        glb.inspect(data[:40])


def test_head_len_covers_header_and_json():
    data = make_glb({"nodes": [{}] * 10})
    n = glb.head_len(data[:20])
    glb.inspect(data[:n])


def test_kinds_are_well_formed():
    for name, k in KINDS.items():
        assert k["roles"], name
        for role, spec in k["roles"].items():
            assert spec["type"] in ("bool", "number"), (name, role)


def test_clean_params_clamps_and_rejects():
    from app.plant.kinds import clean_params
    assert clean_params("slider", {"dir": [0, 2, 0], "dist": 500}) == {"dir": [0.0, 1.0, 0.0], "dist": 100.0}
    assert clean_params("motor", {"axis": "z", "rpm": 0, "self": True}) == {"axis": "z", "rpm": 1.0, "self": True}
    assert clean_params("pipe", {"color": "air", "reverse": True}) == {"color": "air", "reverse": True}
    for kind, bad in [("motor", {"axis": "w"}), ("motor", {"nope": 1}), ("slider", {"dir": [1, 2]}),
                      ("slider", {"dist": "far"}), ("pipe", {"reverse": "yes"}), ("indicator", {"x": 1})]:
        with pytest.raises(ValueError):
            clean_params(kind, bad)
