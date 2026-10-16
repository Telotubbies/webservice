"""rule_kinds — roc, anomaly, forecast alarm rules

Revision ID: 0011
Revises: 0010
"""

from pathlib import Path

from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0011_rule_kinds.sql")


def _raw(sql: str) -> None:
    # Straight to the DBAPI cursor with no params: neither SQLAlchemy bind
    # parsing nor psycopg %-placeholders apply.
    # Same connection/transaction as the Alembic revision.
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    # Not a data-recovery path (doc 18 s2) - restore from the pre-migrate dump.
    _raw("DELETE FROM alarm_rules WHERE kind IN ('roc','anomaly','forecast');"
         " ALTER TABLE alarm_rules DROP CONSTRAINT alarm_rules_shape_check;"
         " ALTER TABLE alarm_rules DROP CONSTRAINT alarm_rules_kind_check;"
         " ALTER TABLE alarm_rules ADD CONSTRAINT alarm_rules_kind_check"
         " CHECK (kind IN ('hi','hihi','lo','lolo','stale'));"
         " ALTER TABLE alarm_rules ADD CONSTRAINT alarm_rules_check CHECK"
         " ((kind = 'stale' AND stale_s IS NOT NULL) OR (kind <> 'stale' AND threshold IS NOT NULL));"
         " ALTER TABLE alarm_rules DROP COLUMN window_s;")
