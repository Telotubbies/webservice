"""per-plan ingest rate

Revision ID: 0065
Revises: 0064
"""

from pathlib import Path

from alembic import op

revision = "0065"

down_revision = "0064"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0065_ingest_rate.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw("ALTER TABLE plans DROP COLUMN ingest_msgs_per_min;")


