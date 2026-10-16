"""model class count

Revision ID: 0019
Revises: 0018
"""

from pathlib import Path

from alembic import op

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0019_model_class_count.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw("ALTER TABLE vision_model_versions DROP COLUMN IF EXISTS class_count;")
