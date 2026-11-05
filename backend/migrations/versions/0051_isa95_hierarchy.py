"""ISA-95 hierarchy: areas, area_grants, lines.area_id

Revision ID: 0051
Revises: 0050
"""

from pathlib import Path

from alembic import op

revision = "0051"
down_revision = "0050"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0051_isa95_hierarchy.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw("DROP TRIGGER lines_default_area ON lines;"
         " DROP FUNCTION lines_default_area();"
         " DROP TABLE area_grants;"
         " ALTER TABLE plant_parts DROP COLUMN device_id;"
         " ALTER TABLE devices DROP COLUMN kind;"
         " ALTER TABLE lines DROP COLUMN area_id, DROP COLUMN kind;"
         " DROP TABLE areas;")
