"""Alarm shelving: who, when and why

Revision ID: 0057
Revises: 0055
"""

from pathlib import Path

from alembic import op

revision = "0057"
# 0056 is reserved for another feature; re-point this at "0056" when it lands.
down_revision = "0056"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0057_alarm_shelf.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw("ALTER TABLE alarms DROP COLUMN shelve_reason, DROP COLUMN shelved_by,"
         " DROP COLUMN shelved_at;")
