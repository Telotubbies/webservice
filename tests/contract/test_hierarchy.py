"""ISA-95 hierarchy (spec 2026-10-19 §5): routes are config-gated where they
write, the command path runs the area gate, and the area_allowed rule is
decided from grants + role alone."""

import asyncio
import inspect
import uuid

from app.edge import commands
from app.plant import hierarchy


def _routes():
    return {(m, r.path): r for r in hierarchy.router.routes for m in r.methods}


def test_hierarchy_routes_are_registered():
    r = _routes()
    base = "/api/v1/orgs/{org}"
    for method, path in [
        ("GET", f"{base}/sites/{{site}}/areas"), ("POST", f"{base}/sites/{{site}}/areas"),
        ("PATCH", f"{base}/sites/{{site}}/areas/{{area}}"),
        ("DELETE", f"{base}/sites/{{site}}/areas/{{area}}"),
        ("GET", f"{base}/sites/{{site}}/hierarchy"),
        ("POST", f"{base}/sites/{{site}}/lines"), ("PATCH", f"{base}/sites/{{site}}/lines/{{line}}"),
        ("POST", f"{base}/sites/{{site}}/devices"), ("PATCH", f"{base}/sites/{{site}}/devices/{{device}}"),
        ("POST", f"{base}/sites/{{site}}/tags/move"),
        ("GET", f"{base}/area-grants"), ("PUT", f"{base}/members/{{user}}/area-grants"),
    ]:
        assert (method, path) in r, (method, path)


def test_every_write_needs_config_write():
    for name, fn in inspect.getmembers(hierarchy, inspect.iscoroutinefunction):
        if name.startswith(("create_", "patch_", "delete_", "move_", "put_")):
            assert "m._CONFIG" in inspect.getsource(fn), f"{name} is not config-gated"


def test_command_issue_runs_the_area_gate_before_inserting():
    src = inspect.getsource(commands.CommandManager.issue)
    assert "area_allowed" in src
    assert src.index("area_allowed") < src.index("INSERT INTO commands")
    assert '"area_forbidden"' in src


class _TC:
    """Just enough of TenantConn for area_allowed()."""
    org_id = uuid.uuid4()

    def __init__(self, role, grants, tag_in_granted_area):
        self.role, self.grants, self.hit = role, grants, tag_in_granted_area

    async def fetchval(self, sql, *a):
        if "FROM memberships" in sql:
            return self.role
        if "count(*) FROM area_grants" in sql:
            return self.grants
        return 1 if self.hit else None


def _allowed(role, grants, hit):
    return asyncio.run(hierarchy.area_allowed(_TC(role, grants, hit), uuid.uuid4(), uuid.uuid4()))


def test_area_rule():
    assert _allowed("operator", 0, False)       # no grants: everywhere
    assert _allowed("operator", 2, True)        # granted area
    assert not _allowed("operator", 2, False)   # outside grants
    assert _allowed("admin", 2, False)          # admin/owner ignore grants
    assert _allowed("owner", 2, False)


def test_service_principal_without_user_is_not_blocked_here():
    assert asyncio.run(hierarchy.area_allowed(_TC("operator", 2, False), None, uuid.uuid4()))
