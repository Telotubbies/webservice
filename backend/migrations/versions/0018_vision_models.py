"""vision model registry — models, versions, per-camera pins, class presets

Revision ID: 0018
Revises: 0017
"""

from pathlib import Path

from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0018_vision_models.sql")


def _raw(sql: str) -> None:
    # Straight to the DBAPI cursor with no params: neither SQLAlchemy bind
    # parsing nor psycopg %-placeholders apply.
    # Same connection/transaction as the Alembic revision.
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    # Not a data-recovery path (doc 18 §2) — restore from the pre-migrate dump.
    _raw("DROP TABLE IF EXISTS class_presets; DROP TABLE IF EXISTS camera_models;"
         " DROP TABLE IF EXISTS vision_model_versions; DROP TABLE IF EXISTS vision_models;")
