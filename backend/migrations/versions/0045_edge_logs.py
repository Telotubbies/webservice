"""edge logs

Revision ID: 0045
Revises: 0044
"""

from pathlib import Path

from alembic import op

revision = "0045"
down_revision = "0044"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0045_edge_logs.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw("DROP TABLE IF EXISTS edge_logs;")
