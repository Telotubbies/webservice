"""model artifact provenance

Revision ID: 0071
Revises: 0070
"""

from pathlib import Path

from alembic import op

revision = "0071"

down_revision = "0070"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0071_model_artifacts.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw("DROP TABLE IF EXISTS model_artifacts;")



