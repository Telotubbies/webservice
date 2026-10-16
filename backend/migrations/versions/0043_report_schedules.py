"""report schedules

Revision ID: 0043
Revises: 0042
"""

from pathlib import Path

from alembic import op

revision = "0043"
down_revision = "0042"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0043_report_schedules.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw("DROP TABLE IF EXISTS report_schedules;")
