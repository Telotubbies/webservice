"""Auditable commands: 'unknown' status, reason required on new commands

Revision ID: 0056
Revises: 0055
"""

from pathlib import Path

from alembic import op

revision = "0056"
down_revision = "0055"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0056_auditable_commands.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    # 'unknown' rows cannot satisfy the old CHECK: they were never confirmed,
    # so they fold into 'failed' (still not success).
    _raw("UPDATE commands SET status = 'failed' WHERE status = 'unknown';"
         " ALTER TABLE commands DROP CONSTRAINT commands_note_required;"
         " ALTER TABLE commands DROP CONSTRAINT commands_status_check;"
         " ALTER TABLE commands ADD CONSTRAINT commands_status_check"
         " CHECK (status IN ('accepted', 'dispatched', 'acknowledged',"
         " 'rejected', 'failed', 'timeout'))")
