# ADR-0001: Backend module layout and migration format

**Status:** Accepted · **Date:** 2026-10-16 · **Deciders:** project owner

## Context

`backend/app/main.py` had grown to 3,006 lines: app wiring, MQTT ingest, auth
dependencies and 88 inline routes. Newer routers (`orgapi`, `platform`,
`vision/*`) reached back into it through a lazy `_m()` helper to avoid an
import cycle. Two route styles lived side by side.

Migrations ship as a `.py` Alembic revision plus a `.sql` twin, which looked
like duplication.

## Decision

1. **Shared request dependencies live in `app/deps.py`** (auth, `Scope`,
   `_v2_scope`, `org_tx`, `_mutation_gate`, ...). Routers import from it
   directly. `main.py` re-exports these names so existing `_m()` callers and
   tests keep working; migrate them to `deps` opportunistically.
2. **One router per domain.** The v2 admin CRUD moved to `app/api/*.py`
   (alarm_rules, dashboards, downtimes, incidents, members, api_keys, slos,
   audit) and is mounted from `app/api/__init__.py`. New endpoints go in a
   router module, never in `main.py`.
3. **`main.py` keeps only** app construction, middleware, lifespan, MQTT
   ingest, machine/health endpoints, the v1 compat shim, edge provisioning
   and the WebSocket endpoint.
4. **Domain packages under `app/`** (the flat 36-module directory is gone):

   | Package | Holds |
   |---|---|
   | `core/` | config, observability, ratelimit, egress guard, job queue |
   | `iam/` | auth (principals), security (OIDC/JWKS), orgguard, consents |
   | `tenancy/` | orgs, org API, plans, platform back-office, onboarding, webhook workers |
   | `alarming/` | alarm engine, insights, inference client, notifications |
   | `production/` | OEE/downtime, reports, status page, event feed, tag queries |
   | `edge/` | MQTT bridge, dynsec, commands, registry, edge logs, WS hub, enroll codes |
   | `ops/` | one-shot tasks: `python -m app.ops.seed_oidc`, `provision_idp`, `bootstrap`, `seed` |
   | `api/`, `db/`, `datasources/`, `vision/` | v2 admin routers, data layer, data sources, vision |

   Root keeps only `main.py` (wiring) and `deps.py` (shared dependencies).
   New code goes in the package of its domain; a new top-level module needs
   a reason.
5. **Migrations stay as `.py` + `.sql` twins.** The `.sql` is the reviewable,
   hand-runnable artifact; the `.py` only executes it inside the Alembic
   transaction. `tests/contract/test_migrations_layout.py` enforces the pair.
6. **An applied migration is never edited.** Fix forward with a new revision
   (e.g. `0046` replaces the `0033` seat-cap trigger function).

## Consequences

- Easier: finding a route, reviewing a domain in isolation, no import cycles
  for new routers.
- Harder: `main.py` re-exports are a compat layer to retire later.
- To revisit: split `notify.py` (1.4k lines) and `oee.py` (1k lines); move the
  remaining `_m()` users to `deps`; split the ingest code out of `main.py`.

## Action items

1. [x] Extract `deps.py` and `app/api/*`; OpenAPI diff before/after identical (241 operations).
2. [ ] Replace `_m().x` with `deps.x` in the older routers.
3. [ ] Extract ingest (`_handle_*`, `ingest_worker`) to `app/ingest.py`.
