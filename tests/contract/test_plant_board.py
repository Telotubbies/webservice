"""Plant board (F07): request validation and route shape, no database needed."""

import base64
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.plant import board

PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 16
LAYOUT = {"v": 1, "w": 1400, "h": 600, "items": {"15": {"x": 24, "y": 50, "w": 90, "h": 40, "locked": True}},
          "lanes": [{"id": "cement", "y": 24, "h": 100}], "links": {"add": [["15", "18"]], "remove": []}}


def test_layout_round_trips_and_drops_unset_flags():
    out = board.LayoutIn(**LAYOUT).model_dump(exclude_none=True)
    assert out["items"]["15"] == {"x": 24, "y": 50, "w": 90, "h": 40, "locked": True}
    assert out["links"]["add"] == [("15", "18")]


@pytest.mark.parametrize("patch", [
    {"v": 2},
    {"w": 0},
    {"w": 1e9},
    {"items": {"a/b": {"x": 0, "y": 0, "w": 10, "h": 10}}},          # key charset
    {"items": {"1": {"x": 0, "y": 0, "w": 10, "h": 10, "evil": 1}}},  # unknown field
    {"items": {"1": {"x": float("nan"), "y": 0, "w": 10, "h": 10}}},
    {"items": {"1": {"x": 0, "y": 0, "w": -1, "h": 10}}},
    {"items": {str(i): {"x": 0, "y": 0, "w": 10, "h": 10} for i in range(401)}},
    {"links": {"add": [["1", "../x"]], "remove": []}},
    {"extra": 1},
])
def test_layout_rejects_bad_input(patch):
    with pytest.raises(ValidationError):
        board.LayoutIn(**{**LAYOUT, **patch})


def test_model_sha_pattern():
    board.DraftIn(model_sha="a" * 64, layout=LAYOUT)
    board.DraftIn(model_sha="demo-centrale-beton", layout=LAYOUT)
    for bad in ("", "abc", "x" * 65, "a b c d", "../etc"):
        with pytest.raises(ValidationError):
            board.DraftIn(model_sha=bad, layout=LAYOUT)


def test_capture_input_bounds():
    ok = {"key": "15", "w": 90, "h": 40, "view": "side", "png_b64": base64.b64encode(PNG).decode(),
          "box": {"min": [0, 0, 0], "max": [1, 1, 1]}}
    board.CapturesIn(model_sha="a" * 64, items=[ok])
    for patch in ({"view": "top"}, {"w": 0}, {"w": 5000}, {"box": {"min": [0], "max": [1, 1, 1]}}):
        with pytest.raises(ValidationError):
            board.CapturesIn(model_sha="a" * 64, items=[{**ok, **patch}])
    with pytest.raises(ValidationError):
        board.CapturesIn(model_sha="a" * 64, items=[])


def test_routes_are_site_scoped():
    seen = {(m, r.path) for r in board.router.routes for m in r.methods}
    base = "/api/v1/orgs/{org}/sites/{site}/plant-board"
    assert seen == {("GET", base), ("PUT", base + "/draft"), ("POST", base + "/publish"),
                    ("POST", base + "/rollback"), ("GET", base + "/captures"), ("PUT", base + "/captures")}


def test_migration_0058_has_rls_on_both_tables():
    sql = (Path(board.__file__).parents[2] / "migrations" / "versions" / "0058_plant_boards.sql").read_text(encoding="utf-8")
    for t in ("plant_boards", "plant_board_captures"):
        assert f"CREATE TABLE {t}" in sql and f"'{t}'" in sql
    assert "FORCE ROW LEVEL SECURITY" in sql and "wds_ctx_org()" in sql
