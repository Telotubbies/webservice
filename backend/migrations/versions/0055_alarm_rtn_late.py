"""Alarm lifecycle: rtn_unack state, late flag, history survives rule delete

Revision ID: 0055
Revises: 0054
"""

from pathlib import Path

from alembic import op

revision = "0055"
down_revision = "0054"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0055_alarm_rtn_late.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    # orphaned history (rule deleted) cannot satisfy NOT NULL / CASCADE again
    _raw("DELETE FROM alarms WHERE rule_id IS NULL;"
         " UPDATE alarms SET state = 'cleared' WHERE state = 'rtn_unack';"
         " ALTER TABLE alarms DROP CONSTRAINT alarms_org_id_tag_id_rule_id_fkey;"
         " ALTER TABLE alarms ADD CONSTRAINT alarms_org_id_tag_id_rule_id_fkey"
         " FOREIGN KEY (org_id, tag_id, rule_id) REFERENCES alarm_rules (org_id, tag_id, id)"
         " ON DELETE CASCADE;"
         " ALTER TABLE alarms ALTER COLUMN rule_id SET NOT NULL;"
         " ALTER TABLE alarms DROP COLUMN rule_name, DROP COLUMN late;"
         " DROP INDEX alarms_one_open_per_rule;"
         " CREATE UNIQUE INDEX alarms_one_open_per_rule ON alarms (org_id, rule_id)"
         " WHERE state IN ('active', 'acked');"
         " ALTER TABLE alarms DROP CONSTRAINT alarms_state_check;"
         " ALTER TABLE alarms ADD CONSTRAINT alarms_state_check"
         " CHECK (state IN ('active', 'acked', 'cleared'));")
