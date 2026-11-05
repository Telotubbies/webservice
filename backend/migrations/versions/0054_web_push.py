"""Web Push: push_subscriptions, webpush channel, mobile_control

Revision ID: 0054
Revises: 0050
"""

from pathlib import Path

from alembic import op

revision = "0054"
down_revision = "0053"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0054_web_push.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw("DROP TABLE push_subscriptions;"
         " ALTER TABLE organizations DROP COLUMN mobile_control;"
         " DELETE FROM notification_channels WHERE type = 'webpush';"
         " ALTER TABLE notification_channels DROP CONSTRAINT notification_channels_type_check;"
         " ALTER TABLE notification_channels ADD CONSTRAINT notification_channels_type_check"
         " CHECK (type IN ('email', 'line', 'webhook', 'teams', 'slack'));")
