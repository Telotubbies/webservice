"""readyz migration probe: wds_app may read alembic_version (v4 T8)

Revision ID: 0005
Revises: 0004

/readyz checks `alembic_version == code head` on the app pool; the version
table is owner-created, so the runtime role needs an explicit SELECT grant.
Read-only, one table — no schema state changes hands.
"""

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("GRANT SELECT ON alembic_version TO wds_app")


def downgrade() -> None:
    op.execute("REVOKE SELECT ON alembic_version FROM wds_app")
