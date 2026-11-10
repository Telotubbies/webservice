"""gate_min_accuracy as double precision

Revision ID: 0073
Revises: 0072
"""

from pathlib import Path

from alembic import op

revision = "0073"

down_revision = "0072"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0073_gate_accuracy_double.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw("ALTER TABLE vision_models ALTER COLUMN gate_min_accuracy TYPE real;")
