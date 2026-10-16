"""Read the facts the registry needs out of a YOLO26 ONNX export (plan M1-04 T2).

ONNX is protobuf data: parsing it never executes anything. Still, the backend
calls `run_inspect`, which runs this module as a subprocess with a time limit
and (on POSIX) an address-space limit, so a hostile file cannot stall or
exhaust the API process.
"""

from __future__ import annotations

import ast
import json
import subprocess
import sys
from pathlib import Path

MAX_NODES = 20_000
MAX_CLASSES = 1000
SUPPORTED_TASKS = ("detect", "segment")


class InspectError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


def parse_names(raw: str) -> list[str]:
    """Ultralytics stores names as a Python dict literal, `{0: 'person', ...}`."""
    try:
        d = ast.literal_eval(raw)
    except (ValueError, SyntaxError, MemoryError, RecursionError):
        raise InspectError("no_classes", "class names metadata is not a plain dict literal") from None
    if isinstance(d, (list, tuple)):
        d = dict(enumerate(d))
    if (not isinstance(d, dict) or not d or len(d) > MAX_CLASSES
            or sorted(d) != list(range(len(d))) or not all(isinstance(v, str) and v for v in d.values())):
        raise InspectError("no_classes", "class names must map ids 0..n-1 to non-empty strings")
    return [d[i][:80] for i in range(len(d))]


def _dims(vi) -> list:
    return [(d.dim_value if d.HasField("dim_value") else d.dim_param or "?")
            for d in vi.type.tensor_type.shape.dim]


def _int(v) -> int | None:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def inspect_onnx(path: Path) -> dict:
    import onnx
    from google.protobuf.message import DecodeError
    try:
        model = onnx.load(str(path), load_external_data=False)
    except (DecodeError, ValueError, OSError, RuntimeError):
        raise InspectError("not_onnx", "the file is not a readable ONNX model") from None
    g = model.graph
    if not g.input or not g.output:
        raise InspectError("not_onnx", "the file is not a readable ONNX model")
    if len(g.node) > MAX_NODES:
        raise InspectError("too_large_graph", f"the graph has more than {MAX_NODES} operators")
    meta = {p.key: p.value for p in model.metadata_props}

    task_meta = (meta.get("task") or "").strip().lower()
    if task_meta and task_meta not in SUPPORTED_TASKS:
        raise InspectError("unsupported_output",
                           f"task '{task_meta}' is not supported yet (detect and segment only)")

    outs = [_dims(o) for o in g.output]
    first = outs[0]
    if len(first) == 3 and first[2] == 6 and len(outs) == 1:
        task = "detect"
    elif len(first) == 3 and len(outs) == 2 and isinstance(first[2], int) and first[2] > 6 \
            and len(outs[1]) == 4 and outs[1][1] == first[2] - 6:
        task = "segment"
    else:
        raise InspectError(
            "unsupported_output",
            f"output shape {first} is not a YOLO26 end-to-end head. It looks like an older or NMS-style export; "
            "re-export with YOLO26 default settings (no nms option) and upload again")
    if task_meta and task_meta != task:
        raise InspectError("unsupported_output", f"metadata says '{task_meta}' but the outputs look like '{task}'")

    in_dims = _dims(g.input[0])
    imgsz = None
    if meta.get("imgsz"):
        try:
            v = ast.literal_eval(meta["imgsz"])
            imgsz = _int(v[0] if isinstance(v, (list, tuple)) else v)
        except (ValueError, SyntaxError, IndexError):
            imgsz = None
    if imgsz is None and len(in_dims) == 4 and isinstance(in_dims[2], int) and in_dims[2] > 0:
        imgsz = in_dims[2]
    if not imgsz or imgsz < 32 or imgsz > 4096:
        raise InspectError("unsupported_output",
                           "cannot determine the input size (dynamic input without an imgsz entry); "
                           "re-export with a fixed imgsz")

    classes = None
    if meta.get("names"):
        classes = parse_names(meta["names"])
    opset = next((o.version for o in model.opset_import if o.domain in ("", "ai.onnx")), 0)
    return {"task": task, "classes": classes, "class_count": _int(meta.get("nc")) or (len(classes) if classes else None),
            "imgsz": imgsz, "stride": _int(meta.get("stride")),
            "ultralytics_version": (meta.get("version") or None) and meta["version"][:40],
            "opset": opset, "output_shapes": outs}


def run_inspect(path: Path, timeout_s: float = 30.0, mem_mb: int = 2048) -> dict:
    """inspect_onnx in a bounded subprocess."""
    code = (
        "import json,sys\n"
        "try:\n import resource; resource.setrlimit(resource.RLIMIT_AS,(%d<<20,%d<<20))\nexcept Exception: pass\n"
        "from app.vision.inspect import inspect_onnx, InspectError\n"
        "try:\n print(json.dumps({'ok':inspect_onnx(__import__('pathlib').Path(sys.argv[1]))}))\n"
        "except InspectError as e:\n print(json.dumps({'err':[e.code,e.message]}))\n"
    ) % (mem_mb, mem_mb)
    try:
        r = subprocess.run([sys.executable, "-c", code, str(path)], capture_output=True, text=True,
                           timeout=timeout_s, cwd=str(Path(__file__).resolve().parents[2]))
    except subprocess.TimeoutExpired:
        raise InspectError("timeout", "inspecting the file took too long") from None
    try:
        doc = json.loads(r.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        raise InspectError("not_onnx", "the file could not be inspected") from None
    if "err" in doc:
        raise InspectError(*doc["err"])
    return doc["ok"]
