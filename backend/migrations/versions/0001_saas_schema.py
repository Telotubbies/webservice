"""multi-tenant schema: tenancy, plant model, telemetry, alarms, commands, audit, RLS

Revision ID: 0001
Revises:
"""

from pathlib import Path

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

_SQL = Path(__file__).with_name("0001_saas_schema.sql")


def _raw(sql: str) -> None:
    # Straight to the DBAPI cursor with no params: neither SQLAlchemy bind
    # parsing (`:MI` in to_char formats) nor psycopg %-placeholders apply.
    # Same connection/transaction as the Alembic revision.
    op.get_bind().connection.dbapi_connection.cursor().execute(sql)


def upgrade() -> None:
    _raw(_SQL.read_text())


def downgrade() -> None:
    # Not a data-recovery path (doc 18 §2) — restore from the pre-migrate dump.
    _raw("""
        DROP TABLE IF EXISTS command_outbox, command_events, commands, alarms, alarm_rules,
          tag_history, tag_latest, tags, edges, devices, lines, sites, invites,
          memberships, audit_log, organizations, revoked_sessions, users CASCADE;
        DROP FUNCTION IF EXISTS audit_chain(), wds_reject_mutation(),
          audit_row_hash(text, uuid, bigint, timestamptz, text, text, jsonb, jsonb),
          wds_ctx_org(), wds_ctx_user(), wds_ctx_invite();
    """)
