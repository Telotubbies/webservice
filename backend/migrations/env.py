"""Alembic env — raw-SQL migrations, run only as wds_owner (ADR-13 §1)."""

import os

from alembic import context
from sqlalchemy import create_engine

dsn = os.environ["WDS_MIGRATE_DSN"]  # postgresql+psycopg://wds_owner:…@postgres/wds


def run_migrations_online() -> None:
    engine = create_engine(dsn)
    with engine.connect() as conn:
        # One transaction per revision: Postgres DDL is transactional, so a
        # failing revision rolls back cleanly (doc 18 §2).
        context.configure(connection=conn, transaction_per_migration=True)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    raise SystemExit("offline mode not supported")
run_migrations_online()
