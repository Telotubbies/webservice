"""org_settings - slug, timezone, language

Revision ID: 0014
Revises: 0013
"""

from pathlib import Path

from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0014_org_settings.sql")


def _raw(sql: str) -> None:
    # Straight to the DBAPI cursor with no params: neither SQLAlchemy bind
    # parsing nor psycopg %-placeholders apply.
    # Same connection/transaction as the Alembic revision.
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    # Not a data-recovery path (doc 18 s2) - restore from the pre-migrate dump.
    _raw("ALTER TABLE organizations DROP COLUMN IF EXISTS slug, DROP COLUMN IF EXISTS timezone, DROP COLUMN IF EXISTS language;")
