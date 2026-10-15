"""config delivery grants for wds_system

Revision ID: 0015
Revises: 0014
"""

from pathlib import Path

from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0015_cfg_delivery_grants.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw("""DROP POLICY IF EXISTS system_ds_status ON data_sources;
    REVOKE UPDATE (status, status_detail, status_at) ON data_sources FROM wds_system;
    REVOKE UPDATE (config_applied, config_error) ON edges FROM wds_system;
    REVOKE SELECT (config_version, config_applied, config_error) ON edges FROM wds_system;""")
