"""material decision: cameras.material, vision_metrics, event kind material

Revision ID: 0049
Revises: 0048
"""

from pathlib import Path

from alembic import op

revision = "0049"
down_revision = "0048"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0049_material_decision.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw("DROP TABLE IF EXISTS vision_metrics;"
         " DELETE FROM vision_events WHERE kind = 'material';"
         " ALTER TABLE vision_events DROP CONSTRAINT vision_events_kind_check;"
         " ALTER TABLE vision_events ADD CONSTRAINT vision_events_kind_check CHECK (kind IN"
         " ('rule_fire','blocked','dry_run','alert_object'));"
         " ALTER TABLE cameras DROP CONSTRAINT IF EXISTS cameras_material_small;"
         " ALTER TABLE cameras DROP COLUMN material;")
