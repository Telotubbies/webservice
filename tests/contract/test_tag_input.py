"""Tag input validation + bulk CSV parsing (pure)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from app.datasources.addresses import AddressError  # noqa: E402
from app.datasources.taginput import (  # noqa: E402
    BulkError,
    TagSpec,
    build_tag,
    norm_name,
    parse_bulk_csv,
)

HDR = "line,device,signal,address,type,unit,writable,min,max,scale\n"


def test_norm_name():
    assert norm_name("Line 1") == "line_1"
    assert norm_name("  Motor-#1 ") == "motor_1"
    with pytest.raises(AddressError):
        norm_name("!!!", "line")


def test_build_tag_modbus():
    spec = TagSpec(line="Line 1", device="Motor 1", signal="Speed",
                   address="40001", type="number", scale=0.1, offset=2)
    t = build_tag("modbus", spec)
    assert t["path"] == "line_1/motor_1/speed"
    assert t["address"]["area"] == "holding_register"
    assert t["scale"] == 0.1 and t["offset_value"] == 2
    assert t["name"] == "speed"


def test_build_tag_minmax_and_bool_scale():
    with pytest.raises(AddressError) as e:
        build_tag("sim", TagSpec(line="a", device="b", signal="c",
                                 address={"behavior": "random_walk"},
                                 min=5, max=1))
    assert e.value.field == "min"
    with pytest.raises(AddressError) as e:
        build_tag("modbus", TagSpec(line="a", device="b", signal="c",
                                    address="%QX0.0", type="bool", scale=2))
    assert e.value.field == "scale"


def test_build_tag_bad_address_reports_field():
    with pytest.raises(AddressError) as e:
        build_tag("modbus", TagSpec(line="a", device="b", signal="c", address="zzz"))
    assert e.value.field.startswith("address")


def test_csv_ok():
    rows = parse_bulk_csv("modbus", HDR +
                          "L1,M1,run,%QX0.0,bool,,true,,,\n"
                          "L1,M1,speed,40001,number,rpm,false,0,100,0.1\n")
    assert [r["path"] for r in rows] == ["l1/m1/run", "l1/m1/speed"]
    assert rows[0]["type"] == "bool" and rows[0]["writable"] is True
    assert rows[1]["max_value"] == 100 and rows[1]["scale"] == 0.1


def test_csv_collects_all_row_errors():
    with pytest.raises(BulkError) as e:
        parse_bulk_csv("modbus", HDR +
                       "L1,M1,run,%QX0.0,bool,,true,,,\n"
                       "L1,M1,bad,zzz,number,,,,,\n"
                       "L1,M1,x,40001,number,,maybe,,,\n"
                       "L1,M1,run,40002,number,,,,,\n")
    rows = {(x["row"], x["field"]) for x in e.value.errors}
    assert (3, "address") in rows
    assert (4, "writable") in rows
    assert any(x["row"] == 5 and x["field"] == "signal" for x in e.value.errors)  # duplicate path


def test_csv_header_and_limits():
    with pytest.raises(BulkError) as e:
        parse_bulk_csv("modbus", "foo,bar\n1,2\n")
    assert e.value.errors[0]["row"] == 1
    with pytest.raises(BulkError):
        parse_bulk_csv("modbus", HDR)  # no rows
    big = HDR + "".join(f"l,d,s{i},40001,number,,,,,\n" for i in range(1001))
    with pytest.raises(BulkError):
        parse_bulk_csv("modbus", big)
