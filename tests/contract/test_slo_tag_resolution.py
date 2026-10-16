"""Unit tests for `_org_tag_or_400` โ€” the SLO endpoint's org-scoped tag
name resolution (offline, no services needed). Uses a real `Registry`
with hand-populated internals so `for_org`/`display_name` logic runs for
real, and a spy `maybe_refresh` to pin the staleness contract: the lookup
must refresh the cache like every other registry-backed path.
"""

import asyncio
import sys
import time
from pathlib import Path
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from fastapi import HTTPException  # noqa: E402

from app.api.slos import _org_tag_or_400  # noqa: E402
from app.registry import Registry, Tag  # noqa: E402

ORG_ID = UUID("0199d000-0000-7000-8000-00000000a001")
OTHER_ORG = UUID("0199d000-0000-7000-8000-00000000b999")
SITE_ID = UUID("0199d000-0000-7000-8000-00000000b001")


def run(coro):
    return asyncio.run(coro)


def _tag(path: str, org_id: UUID = ORG_ID, site_id: UUID = SITE_ID) -> Tag:
    return Tag(id=uuid4(), org_id=org_id, site_id=site_id, edge_id=None,
               path=path, name=path.rsplit("/", 1)[-1], type="bool",
               unit=None, writable=True, min_value=None, max_value=None)


def _registry(*tags: Tag, site_code: str = "plant1") -> Registry:
    reg = Registry(pool=None)
    reg._by_key = {(t.site_id, t.path): t for t in tags}
    reg._sites = {t.site_id: (t.org_id, site_code) for t in tags}
    reg._loaded_at = time.monotonic()  # fresh โ€” refresh() itself never runs
    return reg


def _request(reg: Registry):
    return SimpleNamespace(
        app=SimpleNamespace(
            state=SimpleNamespace(st=SimpleNamespace(registry=reg))))


def test_resolves_display_name_and_refreshes():
    tag = _tag("sort/line1/motor1/running")
    reg = _registry(tag)
    calls = []

    async def spy():
        calls.append(1)

    reg.maybe_refresh = spy
    found = run(_org_tag_or_400(_request(reg), ORG_ID,
                                "plant1.sort.line1.motor1.running"))
    assert found is tag
    assert calls == [1]


def test_unknown_name_is_400():
    reg = _registry(_tag("sort/line1/motor1/running"))
    with pytest.raises(HTTPException) as e:
        run(_org_tag_or_400(_request(reg), ORG_ID, "plant1.nope.nope"))
    assert e.value.status_code == 400
    assert e.value.detail == "invalid_request: tag"


def test_same_display_name_in_another_org_not_visible():
    # A second org can hold an identical site code + path; membership scope
    # (for_org) must win over the display-name match.
    tag = _tag("sort/line1/motor1/running", org_id=OTHER_ORG, site_id=uuid4())
    reg = _registry(tag)
    with pytest.raises(HTTPException) as e:
        run(_org_tag_or_400(_request(reg), ORG_ID,
                            "plant1.sort.line1.motor1.running"))
    assert e.value.status_code == 400


def test_refresh_attempted_before_lookup():
    # Even a hit on stale data must have waited on maybe_refresh first โ€”
    # otherwise a tag provisioned seconds ago can never resolve here.
    reg = _registry()
    calls = []

    async def spy():
        calls.append(1)

    reg.maybe_refresh = spy
    with pytest.raises(HTTPException):
        run(_org_tag_or_400(_request(reg), ORG_ID, "plant1.sort.x.y.z"))
    assert calls == [1]
