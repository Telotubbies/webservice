"""saved datasets

Revision ID: 0064
Revises: 0063
"""

from pathlib import Path

from alembic import op

revision = "0064"

down_revision = "0063"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0064_datasets.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw("DROP TABLE IF EXISTS datasets;")

