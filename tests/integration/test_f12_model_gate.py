"""F12: a model that has not passed its quality gate cannot be activated.

Live part: no thresholds -> 409 gate_not_set. Offline part: gate_state()/matrix() decide
passed / failed / not-enough-samples from human-labelled (predicted, true) pairs.
"""

import asyncio
import uuid

import pytest

from conftest import ADMIN_TOKEN, ORG_ID, VIEWER_TOKEN  # noqa: E402
from onnx_fixtures import detect_onnx  # noqa: E402

BASE = f"/api/v1/orgs/{ORG_ID}/vision/models"


@pytest.fixture()
def admin_api(base_url):
    httpx = pytest.importorskip("httpx")
    with httpx.Client(base_url=base_url, timeout=30.0, headers={"Authorization": f"Bearer {ADMIN_TOKEN}"}) as c:
        yield c


@pytest.fixture()
def bare_model(admin_api):
    """A model with NO gate set (the shared fixture in test_models.py sets one)."""
    r = admin_api.post(BASE, json={"name": f"pytest-gate-{uuid.uuid4().hex[:8]}", "task": "detect"})
    assert r.status_code == 201, r.text
    m = r.json()["model"]
    yield m
    for v in admin_api.get(f"{BASE}/{m['id']}/versions").json()["items"]:
        admin_api.post(f"{BASE}/{m['id']}/versions/{v['id']}/archive")
    admin_api.delete(f"{BASE}/{m['id']}")


@pytest.mark.integration
def test_activation_blocked_until_a_gate_is_set(admin_api, bare_model):
    v = admin_api.post(f"{BASE}/{bare_model['id']}/versions", params={"filename": "m.onnx"}, content=detect_onnx()).json()["version"]
    url = f"{BASE}/{bare_model['id']}/versions/{v['id']}/activate"
    r = admin_api.post(url, json={"attest": True})
    assert r.status_code == 409 and "gate_not_set" in r.text
    # still a draft: the refusal changed nothing
    assert admin_api.get(f"{BASE}/{bare_model['id']}/versions").json()["items"][0]["status"] == "draft"
    # a gate with no reviewed samples yet: passed is None, so activation is allowed only because nothing disproves it
    assert admin_api.put(f"{BASE}/{bare_model['id']}/gate", json={"min_accuracy": 0.9, "min_samples": 5}).status_code == 200
    q = admin_api.get(f"{BASE}/{bare_model['id']}/versions/{v['id']}/quality").json()
    g = q["gate"]      # min_accuracy is stored as float4, so compare approximately
    assert g["min_accuracy"] == pytest.approx(0.9) and g["min_samples"] == 5 and g["passed"] is None
    assert q["confusion"]["n"] == 0 and q["confusion"]["accuracy"] is None


@pytest.mark.integration
def test_gate_endpoints_are_admin_only_and_validated(admin_api, bare_model, base_url):
    httpx = pytest.importorskip("httpx")
    with httpx.Client(base_url=base_url, timeout=10.0, headers={"Authorization": f"Bearer {VIEWER_TOKEN}"}) as v:
        assert v.put(f"{BASE}/{bare_model['id']}/gate", json={"min_accuracy": 0.5, "min_samples": 1}).status_code == 403
    assert admin_api.put(f"{BASE}/{bare_model['id']}/gate", json={"min_accuracy": 1.5, "min_samples": 1}).status_code in (400, 422)
    assert admin_api.put(f"{BASE}/{bare_model['id']}/gate", json={"min_accuracy": 0.5, "min_samples": 0}).status_code in (400, 422)
    assert admin_api.put(f"{BASE}/{uuid.uuid4()}/gate", json={"min_accuracy": 0.5, "min_samples": 1}).status_code == 404


# ---- offline: the gate maths (no stack needed) ----

class FakeTc:
    def __init__(self, gate, pairs):
        self.gate, self.pairs = gate, pairs

    async def fetchrow(self, sql, *a):
        return {"gate_min_accuracy": self.gate[0], "gate_min_samples": self.gate[1]}

    async def fetch(self, sql, *a):
        return [{"pred": p, "tru": t} for p, t in self.pairs]


def _state(gate, pairs):
    from app.vision.quality import gate_state
    return asyncio.run(gate_state(FakeTc(gate, pairs), uuid.uuid4(), uuid.uuid4()))["gate"]["passed"]


def test_gate_fails_below_threshold_with_enough_samples():
    pairs = [("gravel", "gravel")] * 6 + [("gravel", "sand")] * 4          # 60 %
    assert _state((0.8, 10), pairs) is False


def test_gate_passes_at_or_above_threshold():
    pairs = [("gravel", "gravel")] * 9 + [("sand", "gravel")]              # 90 %
    assert _state((0.9, 10), pairs) is True


def test_gate_is_undecided_with_too_few_samples():
    assert _state((0.9, 10), [("sand", "sand")] * 3) is None


def test_matrix_ignores_unlabelled_and_unknown_values():
    from app.vision.quality import matrix
    m = matrix([("gravel", "gravel"), ("gravel", None), ("junk", "sand"), ("sand", "gravel")])
    assert m["n"] == 2 and m["accuracy"] == 0.5
    assert m["cells"]["gravel"]["sand"] == 1
