"""outbound webhook endpoints, delivery log, sweep cursor

Revision ID: 0036
Revises: 0035
"""

from pathlib import Path

from alembic import op

revision = "0036"
down_revision = "0035"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0036_webhooks.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw("DROP TABLE IF EXISTS webhook_cursor;"
         "DROP TABLE IF EXISTS webhook_deliveries;"
         "DROP TABLE IF EXISTS webhook_endpoints;")
