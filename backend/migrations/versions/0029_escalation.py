"""escalation policies + alarm escalation cursor

Revision ID: 0029
Revises: 0028
"""

from pathlib import Path

from alembic import op

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0029_escalation.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw("DROP TABLE IF EXISTS escalation_policies;"
         "ALTER TABLE alarms DROP COLUMN IF EXISTS esc_level,"
         " DROP COLUMN IF EXISTS esc_level_at;")
