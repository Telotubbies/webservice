"""plant board: 2D SCADA board layouts + part captures

Revision ID: 0058
Revises: 0055
"""

from pathlib import Path

from alembic import op

revision = "0058"
down_revision = "0055"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0058_plant_boards.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw("DROP TABLE IF EXISTS plant_board_captures; DROP TABLE IF EXISTS plant_boards;")
