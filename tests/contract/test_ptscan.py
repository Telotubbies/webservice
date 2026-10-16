"""A .pt checkpoint must not be able to run code when it is loaded."""
import os
import pickle
import sys
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from app.vision.ptscan import UnsafeCheckpoint, scan_pt  # noqa: E402


class _Evil:
    def __reduce__(self):
        import os
        return (os.system, ("echo pwned",))


def _zip_with(tmp_path, payload: bytes, name="archive/data.pkl"):
    p = tmp_path / "m.pt"
    with zipfile.ZipFile(p, "w") as z:
        z.writestr(name, payload)
    return p


def test_os_system_pickle_refused(tmp_path):
    for proto in (2, 4, 5):          # GLOBAL and STACK_GLOBAL forms
        with pytest.raises(UnsafeCheckpoint) as e:
            scan_pt(_zip_with(tmp_path, pickle.dumps(_Evil(), protocol=proto)))
        assert e.value.code == "forbidden_import"


def test_builtins_eval_refused(tmp_path):
    class E:
        def __reduce__(self):
            return (eval, ("1+1",))
    with pytest.raises(UnsafeCheckpoint):
        scan_pt(_zip_with(tmp_path, pickle.dumps(E(), protocol=4)))


def test_raw_pickle_not_a_zip_refused(tmp_path):
    p = tmp_path / "raw.pt"
    p.write_bytes(pickle.dumps({"a": 1}))
    with pytest.raises(UnsafeCheckpoint) as e:
        scan_pt(p)
    assert e.value.code == "not_a_zip_checkpoint"


def test_plain_state_dict_allowed(tmp_path):
    import collections
    scan_pt(_zip_with(tmp_path, pickle.dumps(collections.OrderedDict(a=1, b=[1, 2]), protocol=2)))


def test_zip_without_pickle_refused(tmp_path):
    with pytest.raises(UnsafeCheckpoint) as e:
        scan_pt(_zip_with(tmp_path, b"x", name="notes.txt"))
    assert e.value.code == "no_pickle_found"


@pytest.mark.parametrize("w", ["n.pt", "s.pt"])
def test_real_yolo_checkpoints_pass(w):
    p = Path(os.environ.get("YOLO_PT_DIR", ".")) / w
    if not p.exists():
        pytest.skip("real checkpoint not on this machine")
    scan_pt(p)
