"""Inference endpoint — member-readable, response sanitised, never 5xx when the model is down/off."""

import pytest

pytestmark = pytest.mark.integration

from conftest import ORG_ID, VIEWER_TOKEN  # noqa: E402


def test_inference_shape(base_url):
    httpx = pytest.importorskip("httpx")
    with httpx.Client(base_url=base_url, timeout=15.0, headers={"Authorization": f"Bearer {VIEWER_TOKEN}"}) as c:
        r = c.get(f"/api/v1/orgs/{ORG_ID}/inference")
    assert r.status_code == 200, r.text
    d = r.json()
    if not d["configured"]:
        pytest.skip("INFERENCE_URL not set")
    if d["error"]:  # INFERENCE_URL set but nothing listening (scripts/mock_inference.py)
        pytest.skip(f"inference server unreachable: {d['error']}")
    for x in d["results"]:
        assert 0 <= x["score"] <= 1 and x["severity"] in ("info", "warning", "critical")
