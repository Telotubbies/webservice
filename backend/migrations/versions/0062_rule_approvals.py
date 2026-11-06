"""critical alarm rules need a second approver

Revision ID: 0062
Revises: 0058
"""
# down_revision is a placeholder: the integrator sets it to the real head (0061).

from pathlib import Path

from alembic import op

revision = "0062"
down_revision = "0058"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0062_rule_approvals.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw("DROP TABLE IF EXISTS alarm_rule_approvals; ALTER TABLE alarm_rules DROP COLUMN IF EXISTS approval;")
