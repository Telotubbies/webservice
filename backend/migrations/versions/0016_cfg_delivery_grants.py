"""config delivery grants — wds_system reads edge config counters, records edge acks, updates source status

Revision ID: 0016
Revises: 0015
"""

from pathlib import Path

from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0016_cfg_delivery_grants.sql")


def _raw(sql: str) -> None:
    # Straight to the DBAPI cursor with no params: neither SQLAlchemy bind
    # parsing nor psycopg %-placeholders apply.
    # Same connection/transaction as the Alembic revision.
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    # Not a data-recovery path (doc 18 §2) — restore from the pre-migrate dump.
    _raw("""REVOKE UPDATE (status, status_detail, status_at) ON data_sources FROM wds_system;
    REVOKE UPDATE (config_applied, config_error) ON edges FROM wds_system;
    REVOKE SELECT (config_version, config_applied, config_error) ON edges FROM wds_system;""")
