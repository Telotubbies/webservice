"""shift handover: two-signature, immutable once signed

Revision ID: 0060
Revises: 0059
"""

from pathlib import Path

from alembic import op

revision = "0060"
down_revision = "0059"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0060_shift_handover.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw("DROP TABLE IF EXISTS shift_handovers; DROP FUNCTION IF EXISTS shift_handovers_guard();")
