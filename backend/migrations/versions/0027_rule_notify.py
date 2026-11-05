"""alarm rule notify routing + per-episode dedup state

Revision ID: 0027
Revises: 0026
"""

from pathlib import Path

from alembic import op

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0027_rule_notify.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw("DROP TABLE IF EXISTS alarm_notify_state;"
         "ALTER TABLE alarm_rules DROP COLUMN IF EXISTS notify_channel_ids,"
         " DROP COLUMN IF EXISTS notify_team_ids,"
         " DROP COLUMN IF EXISTS notify_oncall_team,"
         " DROP COLUMN IF EXISTS notify_min_severity,"
         " DROP COLUMN IF EXISTS notify_on_clear;")
