"""machine OEE wiring (state map + ideal cycle times)

Revision ID: 0041
Revises: 0040
"""

from pathlib import Path

from alembic import op

revision = "0041"
down_revision = "0040"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0041_machine_oee.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw("DROP TABLE IF EXISTS machine_products; DROP TABLE IF EXISTS machine_state_map;")
