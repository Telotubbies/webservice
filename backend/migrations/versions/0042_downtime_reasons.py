"""downtime reason tree + machine-stop downtime records

Revision ID: 0042
Revises: 0041
"""

from pathlib import Path

from alembic import op

revision = "0042"
down_revision = "0041"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0042_downtime_reasons.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw("""
-- stop rows can't exist in the pre-0042 shape (ends_at was NOT NULL):
-- remove them before restoring the relaxed NOT NULLs.
DELETE FROM downtimes WHERE kind = 'stop';
ALTER TABLE downtimes
  ALTER COLUMN ends_at SET NOT NULL,
  ALTER COLUMN created_by SET NOT NULL,
  DROP COLUMN kind, DROP COLUMN site_id, DROP COLUMN device_id,
  DROP COLUMN state, DROP COLUMN needs_reason, DROP COLUMN reason_id,
  DROP COLUMN note, DROP COLUMN classified_by, DROP COLUMN classified_at;
DROP TABLE IF EXISTS downtime_reasons;
""")
