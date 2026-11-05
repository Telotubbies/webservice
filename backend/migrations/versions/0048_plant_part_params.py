"""plant parts: params + pipe/slider kinds

Revision ID: 0048
Revises: 0047
"""

from pathlib import Path

from alembic import op

revision = "0048"
down_revision = "0047"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0048_plant_part_params.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw("ALTER TABLE plant_parts DROP CONSTRAINT IF EXISTS plant_parts_params_small;"
         " DELETE FROM plant_parts WHERE kind IN ('pipe', 'slider');"
         " ALTER TABLE plant_parts DROP CONSTRAINT plant_parts_kind_check;"
         " ALTER TABLE plant_parts ADD CONSTRAINT plant_parts_kind_check CHECK (kind IN"
         " ('motor','conveyor','vessel','valve','pump','mixer','indicator'));"
         " ALTER TABLE plant_parts DROP COLUMN params;")
