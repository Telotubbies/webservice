"""Tiny in-memory ONNX files shaped like YOLO26 exports (no weights, no network)."""

from __future__ import annotations

NAMES3 = "{0: 'person', 1: 'bicycle', 2: 'car'}"


def make_onnx(outputs=((1, 300, 6),), meta=None, in_shape=(1, 3, 640, 640)) -> bytes:
    import onnx
    from onnx import TensorProto, helper
    x = helper.make_tensor_value_info("images", TensorProto.FLOAT, list(in_shape))
    outs, nodes = [], []
    for i, shape in enumerate(outputs):
        name = f"output{i}"
        outs.append(helper.make_tensor_value_info(name, TensorProto.FLOAT, list(shape)))
        nodes.append(helper.make_node("Constant", [], [name], value=helper.make_tensor(
            "c", TensorProto.FLOAT, [1], [0.0])))
    m = helper.make_model(helper.make_graph(nodes, "g", [x], outs),
                          opset_imports=[helper.make_opsetid("", 17)])
    for k, v in (meta or {}).items():
        p = m.metadata_props.add()
        p.key, p.value = k, v
    return m.SerializeToString()


def detect_onnx(names: str | None = NAMES3, extra: dict | None = None) -> bytes:
    meta = {"task": "detect", "imgsz": "[640, 640]", "stride": "32", "version": "8.4.0"}
    if names:
        meta["names"] = names
    return make_onnx(((1, 300, 6),), {**meta, **(extra or {})})
