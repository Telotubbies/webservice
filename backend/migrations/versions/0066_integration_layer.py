"""integration layer: ERP connections, outbox, data_origin, scoped keys

Revision ID: 0066
Revises: 0065
"""

from pathlib import Path

from alembic import op

revision = "0066"

down_revision = "0065"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0066_integration_layer.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw("DROP TABLE IF EXISTS integration_outbox, erp_work_order, erp_id_map, erp_connections;"
         " ALTER TABLE api_keys DROP COLUMN scopes; ALTER TABLE sites DROP COLUMN data_origin;")



