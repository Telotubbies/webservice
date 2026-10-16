"""plans catalog + org plan/lifecycle columns + platform_admins

Revision ID: 0032
Revises: 0031
"""

from pathlib import Path

from alembic import op

revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0032_plans_platform.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw(
        # organizations.plan REFERENCES plans(code): the column (and its FK)
        # must go before the plans table can drop.
        "DROP POLICY IF EXISTS system_org_update ON organizations;"
        "ALTER TABLE organizations DROP COLUMN IF EXISTS plan,"
        " DROP COLUMN IF EXISTS trial_ends_at, DROP COLUMN IF EXISTS suspended_at,"
        " DROP COLUMN IF EXISTS suspended_reason;"
        "DROP TABLE IF EXISTS platform_admins;"
        "DROP TABLE IF EXISTS plans;"
    )
