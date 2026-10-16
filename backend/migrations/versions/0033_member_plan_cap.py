"""member-seat plan-cap triggers

Revision ID: 0033
Revises: 0032
"""

from pathlib import Path

from alembic import op

revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0033_member_plan_cap.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw(
        "DROP TRIGGER IF EXISTS memberships_plan_cap ON memberships;"
        "DROP TRIGGER IF EXISTS invites_plan_cap ON invites;"
        "DROP TRIGGER IF EXISTS edges_plan_cap ON edges;"
        "DROP FUNCTION IF EXISTS wds_member_cap_guard();"
        "DROP FUNCTION IF EXISTS wds_edge_cap_guard();"
        "DROP FUNCTION IF EXISTS wds_plan_cap(uuid, text);"
    )
