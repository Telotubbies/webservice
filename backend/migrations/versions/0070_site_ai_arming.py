"""per-site AI arming

Revision ID: 0070
Revises: 0069
"""

from pathlib import Path

from alembic import op

revision = "0070"

down_revision = "0069"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0070_site_ai_arming.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw("DROP TABLE IF EXISTS site_ai_arming;")



