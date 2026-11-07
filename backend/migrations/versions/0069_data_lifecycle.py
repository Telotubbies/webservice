"""data lifecycle

Revision ID: 0069
Revises: 0068
"""

from pathlib import Path

from alembic import op

revision = "0069"

down_revision = "0068"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0069_data_lifecycle.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw("DROP TABLE IF EXISTS org_deletion_certificate, archive_manifest, retention_policy;"
         " ALTER TABLE tag_rollup_1h DROP COLUMN n_bad; ALTER TABLE tag_rollup_1m DROP COLUMN n_bad;")



