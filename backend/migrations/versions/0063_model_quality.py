"""model quality: true_material on reviews + per-model activation gate

Revision ID: 0063
Revises: 0062
"""

from pathlib import Path

from alembic import op

revision = "0063"
# Other branches already hold 0059-0062; the real chain is fixed at integration.
down_revision = "0062"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0063_model_quality.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw("ALTER TABLE vision_models DROP COLUMN gate_min_samples, DROP COLUMN gate_min_accuracy;"
         " ALTER TABLE vision_event_reviews DROP COLUMN true_material;")
