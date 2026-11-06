"""decisions: recorded human choice between options (F10)

Revision ID: 0061
Revises: 0058
"""

from pathlib import Path

from alembic import op

revision = "0061"
# TODO(integration): set to the real head after the other waves merge (0058 is only the head on ui-v4 today).
down_revision = "0058"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0061_decisions.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw("DROP TABLE IF EXISTS decisions;")
