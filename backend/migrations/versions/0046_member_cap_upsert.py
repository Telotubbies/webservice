"""member plan cap: re-seating an existing member is not a new seat

Revision ID: 0046
Revises: 0045
"""

from pathlib import Path

from alembic import op

revision = "0046"
down_revision = "0045"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0046_member_cap_upsert.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    # Not a data-recovery path (doc 18 §2): 0033's function is replaced in place.
    pass
