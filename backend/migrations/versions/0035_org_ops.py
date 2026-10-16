"""org feature flags + announcements

Revision ID: 0035
Revises: 0034
"""

from pathlib import Path

from alembic import op

revision = "0035"
down_revision = "0034"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0035_org_ops.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw("DROP TABLE IF EXISTS announcements; DROP TABLE IF EXISTS org_feature_flags;")
