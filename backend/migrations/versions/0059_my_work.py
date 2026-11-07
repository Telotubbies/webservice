"""my work: partial index for the review inbox

Revision ID: 0059
Revises: 0058
"""

from pathlib import Path

from alembic import op

revision = "0059"
down_revision = "0058"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0059_my_work.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw("DROP INDEX IF EXISTS vision_events_material_time;")
