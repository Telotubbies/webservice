"""MFA policy: organizations.mfa_required, api_keys.allow_control

Revision ID: 0050
Revises: 0049
"""

from pathlib import Path

from alembic import op

revision = "0050"
down_revision = "0049"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0050_mfa_policy.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw("ALTER TABLE api_keys DROP COLUMN allow_control;"
         " ALTER TABLE organizations DROP COLUMN mfa_required;")
