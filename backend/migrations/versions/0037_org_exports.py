"""org data exports

Revision ID: 0037
Revises: 0036
"""

from pathlib import Path

from alembic import op

revision = "0037"
down_revision = "0036"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0037_org_exports.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw("DROP TABLE IF EXISTS org_exports;")
