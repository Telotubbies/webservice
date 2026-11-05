"""system export grants + wds_purge_organization

Revision ID: 0038
Revises: 0037
"""

from pathlib import Path

from alembic import op

revision = "0038"
down_revision = "0037"
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0038_purge_export_grants.sql")


def _raw(sql: str) -> None:
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    _raw(
        "DROP FUNCTION IF EXISTS wds_purge_organization(uuid, boolean);"
        "REVOKE SELECT ON memberships, invites, audit_log, command_events,"
        " dashboards, notebooks, slos, slo_corrections,"
        " teams, team_members, incidents, incident_events,"
        " tag_history, users, commands,"
        " notification_channels, notification_deliveries,"
        " alarm_notify_state, insights FROM wds_system;"
        "REVOKE DELETE ON tag_history FROM wds_system;"
    )
