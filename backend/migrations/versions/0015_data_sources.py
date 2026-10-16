"""data sources, tag addressing, edge config versioning, enrollments

Revision ID: 0015
Revises: 0013
"""

from pathlib import Path

from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0015_data_sources.sql")


def _raw(sql: str) -> None:
    # Straight to the DBAPI cursor with no params: neither SQLAlchemy bind
    # parsing nor psycopg %-placeholders apply.
    # Same connection/transaction as the Alembic revision.
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    # Not a data-recovery path (doc 18 s2) - restore from the pre-migrate dump.
    _raw("""DROP TABLE IF EXISTS edge_enrollments CASCADE;
    ALTER TABLE tags DROP COLUMN IF EXISTS source_id, DROP COLUMN IF EXISTS address, DROP COLUMN IF EXISTS scale, DROP COLUMN IF EXISTS offset_value, DROP COLUMN IF EXISTS deadband;
    DROP TABLE IF EXISTS data_sources CASCADE;
    ALTER TABLE edges DROP COLUMN IF EXISTS config_version, DROP COLUMN IF EXISTS config_applied, DROP COLUMN IF EXISTS config_error;""")
