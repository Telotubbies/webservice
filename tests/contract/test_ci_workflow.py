"""The CI workflow must parse (an unquoted ': ' in a step name once disabled it entirely)."""

from pathlib import Path

import yaml

CI = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "ci.yml"


def test_ci_workflow_parses_and_has_every_gate():
    d = yaml.safe_load(CI.read_text(encoding="utf-8"))
    assert {"contract", "integration", "tenancy-security", "web"} <= set(d["jobs"])
    assert "ui-v4" in d[True]["push"]["branches"]
