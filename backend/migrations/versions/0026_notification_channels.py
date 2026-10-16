"""notification channels + delivery log

Revision ID: 0026
Revises: 0025
"""

from pathlib import Path

from alembic import op

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0026_notification_channels.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw("DROP TABLE IF EXISTS notification_deliveries;"
         "DROP TABLE IF EXISTS notification_channels;")
