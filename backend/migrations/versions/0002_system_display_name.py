"""wds_system may read users.display_name (command/alarm event payloads name the actor)

Revision ID: 0002
Revises: 0001
"""

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("GRANT SELECT (display_name) ON users TO wds_system")


def downgrade() -> None:
    op.execute("REVOKE SELECT (display_name) ON users FROM wds_system")
