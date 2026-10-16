"""ONNX inspector for YOLO26 exports (plan M1-04 Task 2). Graphs are built in memory."""

from __future__ import annotations

import sys

import pytest

onnx = pytest.importorskip("onnx")
from onnx import TensorProto, helper  # noqa: E402

from app.vision.inspect import InspectError, inspect_onnx, parse_names, run_inspect  # noqa: E402

NAMES = "{0: 'person', 1: 'bicycle', 2: 'car'}"


def _model(outputs, meta=None, in_shape=(1, 3, 640, 640), opset=17):
    """A graph that just passes an input through Identity per output (shapes are what the inspector reads)."""
    x = helper.make_tensor_value_info("images", TensorProto.FLOAT, list(in_shape))
    outs, nodes = [], []
    for i, shape in enumerate(outputs):
        name = f"output{i}"
        outs.append(helper.make_tensor_value_info(name, TensorProto.FLOAT, list(shape)))
        nodes.append(helper.make_node("Constant", [], [name], value=helper.make_tensor(
            "c", TensorProto.FLOAT, [1], [0.0])))
    g = helper.make_graph(nodes, "g", [x], outs)
    m = helper.make_model(g, opset_imports=[helper.make_opsetid("", opset)])
    for k, v in (meta or {}).items():
        p = m.metadata_props.add()
        p.key, p.value = k, v
    return m


def _save(tmp_path, model, name="m.onnx"):
    p = tmp_path / name
    onnx.save(model, str(p))
    return p


def test_detect_end_to_end_shape_ok(tmp_path):
    p = _save(tmp_path, _model([(1, 300, 6)], {"names": NAMES, "task": "detect", "imgsz": "[640, 640]",
                                               "stride": "32", "version": "8.4.0"}))
    info = inspect_onnx(p)
    assert info["task"] == "detect" and info["classes"] == ["person", "bicycle", "car"]
    assert info["imgsz"] == 640 and info["stride"] == 32 and info["ultralytics_version"] == "8.4.0"
    assert info["opset"] == 17 and info["output_shapes"] == [[1, 300, 6]]


def test_segment_two_outputs_ok(tmp_path):
    p = _save(tmp_path, _model([(1, 300, 38), (1, 32, 160, 160)], {"names": NAMES, "task": "segment"}))
    info = inspect_onnx(p)
    assert info["task"] == "segment" and info["imgsz"] == 640


def test_names_parsed_and_ids_contiguous():
    assert parse_names(NAMES) == ["person", "bicycle", "car"]
    with pytest.raises(InspectError) as e:
        parse_names("{0: 'a', 2: 'c'}")
    assert e.value.code == "no_classes"


def test_names_missing_reports_no_classes_but_inspects(tmp_path):
    info = inspect_onnx(_save(tmp_path, _model([(1, 300, 6)], {"task": "detect"})))
    assert info["classes"] is None and info["task"] == "detect"


def test_nms_style_output_rejected_with_reexport_hint(tmp_path):
    with pytest.raises(InspectError) as e:
        inspect_onnx(_save(tmp_path, _model([(1, 84, 8400)], {"names": NAMES})))
    assert e.value.code == "unsupported_output" and "re-export" in e.value.message.lower()


def test_unsupported_task_in_metadata(tmp_path):
    with pytest.raises(InspectError) as e:
        inspect_onnx(_save(tmp_path, _model([(1, 300, 6)], {"names": NAMES, "task": "pose"})))
    assert e.value.code == "unsupported_output" and "pose" in e.value.message


def test_dynamic_input_without_imgsz_rejected(tmp_path):
    m = _model([(1, 300, 6)], {"names": NAMES}, in_shape=(1, 3, "h", "w"))
    with pytest.raises(InspectError) as e:
        inspect_onnx(_save(tmp_path, m))
    assert e.value.code == "unsupported_output" and "input size" in e.value.message


def test_not_onnx_bytes_rejected(tmp_path):
    for payload in (b"PK\x03\x04 pickle-ish zip", b"\x80\x04\x95" + b"x" * 50, b""):
        p = tmp_path / "x.onnx"
        p.write_bytes(payload)
        with pytest.raises(InspectError) as e:
            inspect_onnx(p)
        assert e.value.code == "not_onnx"


def test_names_literal_eval_rejects_code():
    for bad in ("__import__('os').system('echo hi')", "{0: __import__('os')}", "{0: open('x')}"):
        with pytest.raises(InspectError):
            parse_names(bad)


def test_run_inspect_subprocess_matches_and_times_out(tmp_path):
    p = _save(tmp_path, _model([(1, 300, 6)], {"names": NAMES, "task": "detect"}))
    assert run_inspect(p)["classes"] == ["person", "bicycle", "car"]
    with pytest.raises(InspectError) as e:
        run_inspect(p, timeout_s=0.001)
    assert e.value.code in ("timeout", "not_onnx")
    bad = tmp_path / "bad.onnx"
    bad.write_bytes(b"garbage")
    with pytest.raises(InspectError) as e2:
        run_inspect(bad)
    assert e2.value.code == "not_onnx"
