"""shifts

Revision ID: 0039
Revises: 0038
"""

from pathlib import Path

from alembic import op

revision = "0039"
down_revision = "0038"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0039_shifts.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw("DROP TABLE IF EXISTS shifts;")
