"""Object keys are built from a fixed kind and UUIDs only: no user text can reach a key."""
import sys
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from app.core import objstore  # noqa: E402

O, I = uuid.uuid4(), uuid.uuid4()


def test_key_layout_is_org_scoped():
    assert objstore.key("videos", O, I) == f"videos/{O}/{I}"
    assert objstore.key("models", O, I, "onnx") == f"models/{O}/{I}.onnx"
    assert objstore.prefix(O, "videos") == f"videos/{O}/"


@pytest.mark.parametrize("kind,org,item", [
    ("../etc", O, I), ("videos", "../other", I), ("videos", O, "x/../y"), ("videos", str(O), I), ("nope", O, I),
])
def test_user_text_cannot_reach_a_key(kind, org, item):
    with pytest.raises(ValueError):
        objstore.key(kind, org, item)


def test_prefix_requires_uuid():
    with pytest.raises(ValueError):
        objstore.prefix("org-a/../org-b")
