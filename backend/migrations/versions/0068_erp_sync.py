"""inbound ERP sync

Revision ID: 0068
Revises: 0067
"""

from pathlib import Path

from alembic import op

revision = "0068"

down_revision = "0067"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0068_erp_sync.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw("DROP TABLE IF EXISTS erp_staging, erp_sync_run, erp_sync_cursor, erp_product;")



