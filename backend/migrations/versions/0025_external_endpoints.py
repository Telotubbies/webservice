"""external model endpoints

Revision ID: 0025
Revises: 0024
"""

from pathlib import Path

from alembic import op

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0025_external_endpoints.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw("DROP TABLE IF EXISTS external_endpoints;"
         " ALTER TABLE vision_models DROP COLUMN IF EXISTS kind;")
