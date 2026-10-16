"""single-use ack-link tokens

Revision ID: 0031
Revises: 0030
"""

from pathlib import Path

from alembic import op

revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0031_ack_tokens.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw("DROP TABLE IF EXISTS ack_tokens;")
