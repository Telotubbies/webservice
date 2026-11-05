"""tag_history retention: wds_system may DELETE (go-live G3)

Revision ID: 0006
Revises: 0005

The backend prunes rows older than HISTORY_MAX_AGE_S every
HISTORY_PRUNE_S, per org inside tenant_tx (RLS still applies). The BRIN
index on ts (0001) keeps the `ts < cutoff` scan cheap.
"""

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("GRANT DELETE ON tag_history TO wds_system")


def downgrade() -> None:
    op.execute("REVOKE DELETE ON tag_history FROM wds_system")
