"""Postgres access layer (ADR-13).

- pool.py     asyncpg pools for the two runtime roles (wds_app, wds_system)
- context.py  the ONLY place tenant/user context is set (set_config, tx-local)
- util.py     wire-format helpers (ISO-8601 Z timestamps, JSON-safe values)
"""
