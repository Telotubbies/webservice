"""downtimes table — maintenance windows that mute alarms

Revision ID: 0008
Revises: 0007
"""

from pathlib import Path

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0008_downtimes.sql")


def _raw(sql: str) -> None:
    # Straight to the DBAPI cursor with no params: neither SQLAlchemy bind
    # parsing nor psycopg %-placeholders apply.
    # Same connection/transaction as the Alembic revision.
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text())


def downgrade() -> None:
    # Not a data-recovery path (doc 18 §2) — restore from the pre-migrate dump.
    _raw("DROP TABLE IF EXISTS downtimes CASCADE;")
