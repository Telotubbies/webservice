# ADR-0002: Historian on native Postgres partitions, not TimescaleDB

Status: accepted (2026-10-19) · Spec: `docs/superpowers/specs/2026-10-19-scada-parity-design.md` §6

## Context

`tag_history` grows without bound and long-range trends scanned raw samples. The
spec proposed TimescaleDB (hypertable, compression, continuous aggregates) and
named a fallback if row-level security did not survive the move. Every tenant
table here is protected by forced RLS, so the spike was the first task of P2.

## Spike result (timescale/timescaledb:2.17.2-pg16, PostgreSQL 16.6)

| Check | Result |
|---|---|
| `create_hypertable` on a table with forced RLS and a policy | works |
| Queries as a non-owner role over hypertable chunks | policy applies, no leak |
| `ALTER TABLE ... SET (timescaledb.compress)` on that table | **refused**: `compression cannot be used on table with row security` |
| `CREATE MATERIALIZED VIEW ... WITH (timescaledb.continuous)` on it | **refused**: `cannot create continuous aggregate on hypertable with row security` |

Without compression and continuous aggregates a hypertable gives chunking only,
which declarative partitioning also gives.

## Decision

Use the fallback branch of the spec:

- `tag_history` is `PARTITION BY RANGE (ts)`, one partition per month, plus a
  default partition so a late or far-future sample never fails ingest.
  Primary key `(tag_id, ts)` is unchanged (it contains the key), so QoS1 replay
  de-duplication (`ON CONFLICT`) keeps working.
- New column `vn` (number, bool as 0/1, else NULL) computed at ingest. Queries
  stop casting `v::text::float8`.
- `tag_rollup_1m` and `tag_rollup_1h` are ordinary tables with ordinary RLS.
  A job (`production/rollup.py`, every 60 s, one runner across replicas via an
  advisory lock) refreshes them: 1m from raw, 1h from 1m. Because they are plain
  RLS tables the app reads them directly; no `SECURITY DEFINER` read function is
  needed (the spec needed one only because continuous aggregates cannot carry RLS).
- Partition DDL sits behind two `SECURITY DEFINER` functions
  (`wds_history_ensure_partitions`, `wds_history_drop_before`). Partition children
  carry no grants for `wds_app` / `wds_system`, so they are reachable only through
  the parent and its policy (`tests/tenancy/test_rls_coverage.py`).
- Retention: per-org `DELETE` (keyed on the primary key, not `ctid`, which is only
  unique inside one partition) plus dropping whole months older than the longest
  plan retention. 1m rollups keep `min(plan, 90 d)`, 1h rollups keep the plan's retention.
- `tagquery` answers a bucketed request from the coarsest rollup whose bucket
  divides the request (`pick_source`) and reports `"source": "raw|1m|1h"`.

## Consequences

- No image change, no extension, no Timescale licence question; the Postgres
  image and volume stay as they are.
- No columnar compression. Disk use per sample is that of plain Postgres. If
  storage becomes the constraint, the options are shorter raw retention (rollups
  outlive raw) or moving history to a store that supports tenant isolation natively.
  The "compressed N×" figure planned for Admin › Storage is dropped.
- A sample that arrives after its minute/hour was aggregated is picked up by the
  next pass (2 h window each minute, 9 h window once an hour, matching the 8 h
  late-sample limit at ingest).
- Rollups are derived data: they can be rebuilt by deleting rows, the refresher
  backfills from the oldest raw sample when a tenant has none.
- Migration 0052 cannot be downgraded (it rewrites the table); `make migrate`
  takes a dump first and that is the way back.
- Creating a month whose range already holds rows in the default partition moves
  them first (`wds_history_ensure_partitions`), covered by a tenancy test.

## Revisit when

Timescale lifts the RLS restriction on compression / continuous aggregates, or
history volume makes per-month partitions too coarse.
