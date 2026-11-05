"""tag_history range partitions, vn, rollups

Revision ID: 0052
Revises: 0050
"""

from pathlib import Path

from alembic import op

revision = "0052"
down_revision = "0051"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0052_history_partitions.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    raise NotImplementedError(
        "0052 rewrites tag_history into a partitioned table; restore from the"
        " pre-migrate dump (make migrate takes one) instead of downgrading")
