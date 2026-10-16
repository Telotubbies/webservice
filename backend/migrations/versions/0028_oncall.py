"""on-call weekly rotations + overrides

Revision ID: 0028
Revises: 0027
"""

from pathlib import Path

from alembic import op

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0028_oncall.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw("DROP TABLE IF EXISTS oncall_overrides;"
         "DROP TABLE IF EXISTS oncall_rotations;")
