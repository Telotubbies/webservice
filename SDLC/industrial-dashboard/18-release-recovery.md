# 18 — Release & Recovery Plan (local production-like stack)

## 1. Release unit

- One git tag = one set of image tags (`backend`, `edge-bridge`, `web`) + one Alembic head + one Keycloak realm export + one dynsec bootstrap.
- `make release-check` runs the full suite (doc 09 + `tests/INVARIANTS.md`) against the composed stack before a tag is cut.

## 2. Schema migrations

- Every Alembic revision runs in a single transaction (Postgres DDL is transactional). A failure rolls back automatically.
- `make migrate`:
  1. `pg_dump -Fc` to `backups/pre-<rev>-<ts>.dump`
  2. `alembic upgrade head` as `wds_owner`
  3. smoke test `/readyz`
  4. on failure, print the restore command
- After the first SaaS release, changes are **expand → migrate → contract**: add nullable columns/tables, deploy code that writes both, backfill, then drop the old ones in a later release. No release both renames and drops.
- Downgrades exist for every revision but are **not** a data-recovery tool. Restoring from the dump is the recovery path.

## 3. SQLite → Postgres one-time migration

`scripts/migrate_sqlite_to_pg.py --sqlite backend/data/app.db --dry-run`
1. Creates org "Demo", site "plant1", edge "edge1" (`status=pending`, no credential) and lines/devices derived from the tag names.
2. Maps tag name → `tags.id` and copies `tags`, `tags_latest`, `tags_history` (ON CONFLICT DO NOTHING), `alarms`, `commands` (status mapping in doc 16 §3) and `audit_log`. The new audit chain starts with a genesis row `migration.import` that records source row counts and a sha256 of the SQLite file.
3. Idempotent: rerunning inserts nothing new. `--dry-run` prints per-table counts and exits.
4. Rollback: the SQLite volume is never modified. Reverting means checking out the previous tag and running `make up`.

## 4. Audit integrity

- Grants: `wds_app`/`wds_system` get INSERT and SELECT only.
- Trigger `audit_log_immutable` BEFORE UPDATE OR DELETE raises an exception; TRUNCATE is revoked.
- Hash chain per org: `hash = sha256(prev_hash || canonical_json(row without hash))`. Concurrent inserts serialize through `pg_advisory_xact_lock(hashtext(org_id))`.
- `make verify-audit` recomputes the chains and exits non-zero on the first break.
- Retention: no deletion in this release. A future ADR covers archive and purge.

## 5. Backup / restore

| Asset | Backup | Restore drill |
|---|---|---|
| Postgres | `pg_dump -Fc` nightly + pre-migrate | `make restore DUMP=…` into a fresh volume, then `make verify-audit` + smoke |
| Keycloak realm | `kc.sh export --realm wds` (users + config) on each release | import into a fresh container; log in as each seed role |
| dynsec | its JSON file (volume) | optional: the reconciler rebuilds it from the DB (edges then need rotation, doc 17 §6) |
| Edge buffer | local to the edge, not backed up | — |

Phase 6 gate: the restore drill is performed and the time measured, and the timing is recorded in doc 15.

## 6. Secret rotation runbooks

| Secret | Procedure |
|---|---|
| Edge MQTT credential | doc 17 §5 rotate |
| `svc-backend` / `svc-dynsec-admin` passwords | set the new password via dynsec → update `.env` → `docker compose up -d backend` |
| Postgres role passwords | `ALTER ROLE … PASSWORD` → update `.env` → restart backend |
| Keycloak signing key | add a new RS256 key (active) and keep the old one passive for ≥ access-token TTL (5 min) + JWKS cache (10 min); the backend refetches on unknown `kid` (ADR-12); then remove the old key |
| Keycloak client secret (admin API client used by backend for invites) | regenerate in Keycloak → `.env` → restart |

## 7. Rollback

- App rollback: redeploy the previous image tags. Because of the expand/contract rule, the previous code still runs on the current schema.
- Data rollback: restore the pre-migrate dump (§5). This loses data written since then, which is acceptable only in the local/demo context and must be stated in the release notes.

## 8. Operational runbook (pointers)

- **Onboard**: create org → invite admin (Keycloak invite email via MailHog in dev) → create site → provision edge → paste the secret into the edge `.env` → verify `hb` on the Health page.
- **Revoke a user**: remove the membership (effective ≤ 5 s) and/or disable in Keycloak (back-channel logout).
- **Revoke an edge**: doc 17 §5 disable.
- **Triage security events**: `mqtt.topic_identity_mismatch`, `mqtt.orphan_client`, `auth.token_rejected`, `tenancy.cross_scope_attempt` in the `security` log stream.
