"""derived tags: tags.source, tag_formulas

Revision ID: 0053
Revises: 0050
"""

from pathlib import Path

from alembic import op

revision = "0053"
down_revision = "0052"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0053_derived_tags.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw("DROP TABLE tag_formulas;"
         " ALTER TABLE tags DROP CONSTRAINT tags_derived_shape;"
         " ALTER TABLE tags DROP COLUMN source;")
