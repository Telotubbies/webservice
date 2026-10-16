# M0: Stabilize the Branch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the 85 uncommitted files on `feature/design` into reviewable, green commits, and make the prod Keycloak realm free of dev allowances (roadmap Phase 0, items 0.1–0.5).

**Architecture:** No new features. Group the pending work by layer (migrations+backend, tests, web, infra, docs), prove each group builds and passes its suite before committing it, add an automated RLS-coverage test so every future table is checked, add the tenancy job to CI, and split the Keycloak realm into dev and prod files.

**Tech Stack:** Python 3.12 / FastAPI / asyncpg / Alembic, Postgres RLS, pytest, React + Vite + bun, Keycloak realm JSON, GitHub Actions, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-16-saas-launch-roadmap.md` §4 (Phase 0) and §15 (M0).

## Global Constraints

- Every new table has fail-closed RLS: cross-org read and write both blocked (roadmap 0.3).
- `make migrate` works on a fresh DB and on a copy of the current DB (0.2).
- CI must be green on `ui-v4` after the merge; suites: contract, tenancy, security, integration, UAT (0.4).
- Prod realm has no `:5199` origin and no direct grants on `wds-web` (0.5).
- Each commit builds. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Never commit `.env`, `infra/secrets/`, `infra/certs/`, `backups/`, `backend/data/` (already in `.gitignore`).

## Review Focus

- A migration that applies on a fresh DB but fails on a DB already at `0007` with data in it: must apply cleanly (Task 2 runs both).
- A table whose RLS policy exists but is not `FORCE`d, so the table owner bypasses it: the coverage test checks `relforcerowsecurity`.
- A table created with `org_id` but no policy at all (RLS enabled with zero policies reads as "empty", hiding a missing write check): the coverage test requires both a USING and a WITH CHECK clause.
- A migration with a `.sql` twin that drifts from its `.py`: Task 2 checks every `.py` has its `.sql` and the head revision is `0013`.
- Secrets or build output staged by `git add -A`: Task 1 stages by explicit path groups and ends with a check for forbidden paths.

---

### Task 1: Triage the working tree and commit docs/infra/tooling

**Files:**
- Modify: `.gitignore` (only if triage finds untracked build output)
- Commit: `.claude/` decision, `SDLC/factoryio.md`, `docs/`, `scripts/mock_inference.py`, `Makefile`, `docker-compose.yml`, `edge-bridge/*`

- [ ] **Step 1: List what is pending, grouped.** Run `git status --short > $SCRATCH/pending.txt` and confirm the groups below cover every line. Anything uncovered is reported to the user, not guessed.

| Group | Paths |
|---|---|
| G1 docs/tooling | `docs/`, `SDLC/factoryio.md`, `scripts/mock_inference.py`, `Makefile` |
| G2 backend+migrations | `backend/app/**`, `backend/migrations/versions/0008`–`0013` (`.py` and `.sql`) |
| G3 edge | `edge-bridge/**`, `docker-compose.yml` |
| G4 tests | `tests/**` |
| G5 web | `web/**` |
| G6 infra | `infra/keycloak/**` (Task 5) |

- [ ] **Step 2: Decide `.claude/`.** Run `git ls-files .claude` and `ls .claude`. If it holds only `settings.local.json` or caches, add `.claude/settings.local.json` to `.gitignore`; if it holds shared skills or settings, commit those. State the decision in the commit message.
- [ ] **Step 3: Commit G1.** `git add docs SDLC/factoryio.md scripts/mock_inference.py Makefile .gitignore` then `git commit -m "docs: SaaS roadmap, M0 plan, Factory I/O notes, mock inference script"`.
- [ ] **Step 4: Verify.** `git status --short | grep -E "infra/secrets|infra/certs|\.env$|backups/"` prints nothing.

### Task 2: Migrations 0008–0013 apply on fresh and existing DBs

**Files:**
- Test: `tests/contract/test_migrations_layout.py` (create)
- Verify only: `backend/migrations/versions/0008`–`0013`

**Interfaces:**
- Produces: `HEAD = "0013"` convention that Task 3's test and later phases read via `alembic heads`.

- [ ] **Step 1: Write the failing layout test** in `tests/contract/test_migrations_layout.py`:
  - `test_every_py_migration_with_sql_twin_has_it`: for each `versions/NNNN_*.py` whose source contains `with_name(`, the matching `.sql` file exists.
  - `test_revision_chain_is_linear_to_0013`: parse `revision`/`down_revision` from every `.py`; assert one chain, no branches, head `== "0013"`.
  - `test_no_duplicate_revision_ids`.
- [ ] **Step 2: Run** `cd tests && python -m pytest contract/test_migrations_layout.py -v`. Expected: PASS if the tree is consistent; fix whatever it names if not.
- [ ] **Step 3: Fresh DB.** `make clean && make up-test`, then `make migrate`. Expected: exit 0, `alembic_version` = `0013` (`make psql` → `select * from alembic_version`).
- [ ] **Step 4: Existing DB.** Check out `ui-v4` migrations only in a scratch DB: `git stash -u` is forbidden here; instead create a scratch DB at revision `0007` with `alembic upgrade 0007`, insert one org, site, edge, and tag with `make psql`, then run `alembic upgrade head`. Expected: exit 0, the inserted rows still present.
- [ ] **Step 5: Commit** `git add backend/migrations tests/contract/test_migrations_layout.py` → `git commit -m "feat(db): migrations 0008-0013 (downtimes, notebooks, teams/incidents, rule kinds, api keys, slos)"`.

### Task 3: RLS coverage test for every tenant table

**Files:**
- Test: `tests/tenancy/test_rls_coverage.py` (create)
- Modify: `backend/migrations/versions/*` only if the test finds a gap (add a new migration `0014_rls_fixups`, never edit applied ones)

**Interfaces:**
- Consumes: `tests.tenancy.conftest` helpers `SYSTEM_DSN`, `run`, `two_orgs`.
- Produces: `TENANT_TABLES` query result (all public tables with an `org_id` column) that Phase 1+ migrations are automatically held to.

- [ ] **Step 1: Write failing tests** using the system DSN against `pg_catalog`:
  - `test_every_org_id_table_has_forced_rls`: for every public table with an `org_id` column, `relrowsecurity AND relforcerowsecurity`.
  - `test_every_org_id_table_has_using_and_with_check`: the table has a policy where `qual IS NOT NULL` and a policy where `with_check IS NOT NULL` (one `ALL` policy with both counts).
  - `test_cross_org_read_and_write_blocked[table]`, parametrized over the tables from `0008`–`0013` (`downtimes, notebooks, teams, team_members, incidents, incident_notes, alarm_rules, api_keys, slos, slo_corrections`; confirm exact names with `\dt` first): as org A insert a row, as org B `SELECT` returns 0 rows and an `UPDATE`/`INSERT` with A's `org_id` raises `InsufficientPrivilegeError`.
- [ ] **Step 2: Run** `make test-db`. Expected: failures list the exact tables with gaps (or all green).
- [ ] **Step 3: Fix gaps** with `0014_rls_fixups` (`.py` + `.sql` twin, same shape as `0013_slos.py`): `ALTER TABLE … ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY` and the standard `org_id = current_setting('app.org_id')::uuid` policy used by `0001_saas_schema.sql`. Update `test_layout` head to `0014` if added.
- [ ] **Step 4: Run** `make test-db`. Expected: PASS.
- [ ] **Step 5: Commit** tests + any fixup migration: `git commit -m "test(tenancy): RLS coverage for every org_id table"`.

### Task 4: Commit backend, edge, tests, web in green slices

**Files:** groups G2–G5 from Task 1.

- [ ] **Step 1: Backend contract suite.** `make test-contract`. Expected: PASS. Fix failures before continuing; do not skip tests.
- [ ] **Step 2: Commit G2** `git add backend/app` → `git commit -m "feat(backend): downtimes, notebooks, teams/incidents, rule kinds, api keys, slos, inference"`. (Migrations already committed in Task 2; split further by feature if `git diff --stat backend/app` shows unrelated hunks, using `git add -p`.)
- [ ] **Step 3: Commit G3** `git add edge-bridge docker-compose.yml` → `git commit -m "feat(edge): adapters, tags.yaml, compose changes"`.
- [ ] **Step 4: Full stack suites.** `make up-test && make test` (contract + tenancy + integration). Expected: all PASS. Then `make test-security`. Expected: PASS.
- [ ] **Step 5: Commit G4** `git add tests` → `git commit -m "test: contract, integration and tenancy tests for new features"`.
- [ ] **Step 6: Web build.** `make web-build`. Expected: typecheck and bundle succeed. Then commit by area so each commit builds on its own: (a) `web/src/lib`, `web/src/types.ts`, `web/package.json`, `web/bun.lock`, `web/public`; (b) `web/src/app`, `web/src/App.tsx`; (c) `web/src/features`. After each `git commit`, run `cd web && bun run build`; if a slice does not build alone, merge it into the next slice instead.
- [ ] **Step 7: UAT.** `make uat`. Expected: PASS. If a failure is a real regression, fix it in a separate commit.
- [ ] **Step 8: Verify clean.** `git status --short` prints nothing.

### Task 5: Separate the prod Keycloak realm from dev

**Files:**
- Create: `infra/keycloak/realm-wds.prod.json`
- Modify: `infra/keycloak/realm-wds.json` (rename role: dev realm), `docker-compose.yml` (realm import path by `APP_ENV`), `backend/app/config.py` (prod validation)
- Test: `tests/contract/test_realm_prod.py` (create), extend `tests/contract/test_config_prod.py`

**Interfaces:**
- Produces: `realm-wds.prod.json` with `wds-web`: `directAccessGrantsEnabled: false`, redirect URIs, web origins, and post-logout URIs containing only the prod origin read from a `__WEB_ORIGIN__` placeholder.

- [ ] **Step 1: Write failing test** `tests/contract/test_realm_prod.py`:
  - `test_prod_realm_has_no_dev_origins`: no string in `realm-wds.prod.json` contains `localhost`, `127.0.0.1`, or `:5199`.
  - `test_prod_realm_disables_direct_grants`: every client has `directAccessGrantsEnabled == false`.
  - `test_prod_realm_requires_pkce`: `wds-web` has `pkce.code.challenge.method == "S256"`.
  - `test_prod_realm_requires_verified_email`: `verifyEmail == true` and `registrationAllowed` is set intentionally (Phase 1.1 relies on this).
- [ ] **Step 2: Run.** Expected: FAIL (file missing).
- [ ] **Step 3: Create the prod realm** by copying `realm-wds.json`, removing dev origins and direct grants, setting the items the tests name. Remove seeded dev users and their passwords. Keep the dev file unchanged so `make seed-dev` still works.
- [ ] **Step 4: Wire compose.** The Keycloak import mounts `realm-wds.prod.json` when `APP_ENV=prod` and `realm-wds.json` otherwise. Extend `test_config_prod.py` with `test_prod_refuses_dev_realm_origins` if `config.py` already validates prod settings; otherwise skip this and note it.
- [ ] **Step 5: Run** `make test-contract`. Expected: PASS. Then `APP_ENV=dev make up-test` still logs in the seeded users (`make seed-dev` exit 0).
- [ ] **Step 6: Review the diff** `git diff --no-index infra/keycloak/realm-wds.json infra/keycloak/realm-wds.prod.json` and hand it to the user for the sign-off the roadmap requires ("realm export diff reviewed").
- [ ] **Step 7: Commit** `git commit -m "feat(keycloak): prod realm without dev origins or direct grants"`.

### Task 6: CI runs what the roadmap says is green

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Change triggers** to `branches: [main, ui-v4]` for push, so the merge target is gated (roadmap 0.4 says "CI green on `ui-v4`").
- [ ] **Step 2: Add a `tenancy` job** after bringing up the test stack: `make test-db` with the same env as `make test-db` uses (`DB_TEST_ENV`). Add a `security` job running `make test-security`. Reuse the integration job's stack bring-up steps.
- [ ] **Step 3: Validate** with `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"`. Expected: no error. Push the branch and open a PR to `ui-v4` only after the user approves pushing; report the CI result as it is.
- [ ] **Step 4: Commit** `git commit -m "ci: gate ui-v4, add tenancy and security jobs"`.

---

## M1 ordering (outline; each item gets its own plan)

Plans are written one at a time, each after the previous one lands, because later interfaces depend on what earlier code really looks like. The order below is the roadmap's §15.

| # | Plan | Roadmap | Depends on |
|---|---|---|---|
| 1 | Sign-up, verify, create org, org switcher | 1.1, 1.2 | M0 realm |
| 2 | Gateway enrollment, PLC connections, tags from web, templates | spec A (existing plan `2026-10-15-phase-a-data-sources.md`) | 1 |
| 3 | Cameras, vision-worker, frame relay | spec B, V3 decision on frame channel | 2 |
| 4 | Model upload, inspect, converter sandbox, registry, class config | 9.1–9.4, 9.11 | 3 |
| 5 | Edge model server, placement, distribution | 9.5 edge, 9.10 | 4 |
| 6 | Vision rules on edge, events | 9.7, 9.8 | 5 |
| 7 | Job runner + notification channels + routing + ack links | 3.1, 3.2, 3.4 | 1 |
| 8 | Onboarding checklist, spec C | 1.3 | 2, 7 |
| 9 | Phase 4 cleanup (real or hidden pages), prod-nav demo-data test | §8 | all |
| 10 | Legal consent, status page, docs, Thai/English CI check | 8.1, 8.4–8.6 | 9 |

Open decision 4 (thesis deadline: all of M1, or only the vision demo) reorders this table: if demo only, plans 3–6 move ahead of 1, 7, 8.
