"""alarm lifecycle: shelve / assign columns + append-only alarm_events

Revision ID: 0030
Revises: 0029
"""

from pathlib import Path

from alembic import op

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0030_alarm_lifecycle.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw("DROP TABLE IF EXISTS alarm_events;"
         "ALTER TABLE alarms DROP COLUMN IF EXISTS shelved_until,"
         " DROP COLUMN IF EXISTS assigned_to;")
