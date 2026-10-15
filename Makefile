# webservice — one command surface. `make` with no target lists them.
COMPOSE := docker compose -f docker-compose.yml
COMPOSE_TEST := docker compose -f docker-compose.yml -f docker-compose.test.yml
PY ?= $(or $(wildcard $(CURDIR)/.venv/Scripts/python.exe),$(wildcard $(CURDIR)/.venv/bin/python),python3)
# host port of the backend; this box reserves 8000, so honour BACKEND_PORT from .env
BACKEND_PORT ?= $(or $(shell sed -n "s/^BACKEND_PORT=//p" .env 2>/dev/null),8000)
SQLITE ?= backend/data/app.db
# Windows default codepage (cp874) breaks read_text() in tests
export PYTHONUTF8 := 1
DB_TEST_ENV := WDS_TEST_APP_DSN=postgresql://wds_app:$${WDS_APP_PASSWORD:-app-dev-pass}@127.0.0.1:5433/wds \
  WDS_TEST_SYSTEM_DSN=postgresql://wds_system:$${WDS_SYSTEM_PASSWORD:-system-dev-pass}@127.0.0.1:5433/wds \
  WDS_TEST_SUPER_DSN=postgresql://postgres:$${POSTGRES_SUPERUSER_PASSWORD:-postgres-dev-pass}@127.0.0.1:5433/wds

.PHONY: psql help up up-test down ps logs build clean secrets secrets-check certs test test-contract test-db test-integration test-security test-perf uat web-build migrate verify-audit seed-dev idp backup restore migrate-sqlite

help: ## show this
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  %-20s %s\n", $$1, $$2}'

secrets: ## generate identity secrets incl. pg/keycloak files (infra/secrets — gitignored)
	./infra/gen-secrets.sh

secrets-check: ## fail if any infra/secrets file still holds a documented dev default (required for APP_ENV=prod)
	@bad=""; for pair in \
	  "pg_super_pw postgres-dev-pass" "wds_owner_pw owner-dev-pass" \
	  "wds_app_pw app-dev-pass" "wds_system_pw system-dev-pass" \
	  "kc_admin_pw admin-dev-pass" "kc_demo_pw kc-demo-pass"; do \
	  set -- $$pair; \
	  if [ -f "infra/secrets/$$1" ] && [ "$$(cat "infra/secrets/$$1")" = "$$2" ]; then \
	    bad="$$bad $$1"; fi; done; \
	if [ -n "$$bad" ]; then \
	  if [ "$${APP_ENV:-dev}" = "prod" ]; then \
	    echo "secrets-check FAIL — dev-default secrets present:$$bad"; \
	    echo "(the backend never sees pg/owner secret files, so config.py"; \
	    echo "can't catch them — prod deploys MUST run this before compose up)"; \
	    exit 1; \
	  fi; \
	  echo "secrets-check: dev defaults present (ok under APP_ENV=dev):$$bad"; \
	else echo "secrets-check: no dev defaults found"; fi

certs: ## generate the dev CA + broker TLS cert (infra/certs — gitignored)
	./infra/gen-certs.sh

up: secrets certs ## build + start the full stack, wait for health (+ Keycloak seed in dev)
	@if [ "$${APP_ENV:-dev}" = "prod" ]; then $(MAKE) secrets-check; fi
	$(COMPOSE) up -d --build --wait
	$(MAKE) idp
	@if [ "$${APP_ENV:-dev}" = "dev" ]; then $(MAKE) seed-dev; fi

down: ## stop the stack (data volume survives)
	$(COMPOSE) down

ps: ## service status
	$(COMPOSE) ps

logs: ## tail all service logs
	$(COMPOSE) logs -f --tail=100

build: ## rebuild images without starting
	$(COMPOSE) build

clean: ## stop the stack AND delete the data volumes (fresh DB + dynsec state)
	$(COMPOSE) down -v

test-contract: ## contract/unit tests — no services needed
	cd tests && $(PY) -m pytest -m "not integration"

up-test: secrets certs ## start the stack with the test overlay (Postgres on 127.0.0.1:5433, MQTT :1883, tester identity)
	$(COMPOSE_TEST) up -d --build --wait
	@if [ "$${APP_ENV:-dev}" = "dev" ]; then $(MAKE) seed-dev; fi

test-db: ## tenant-isolation / RLS / audit gate as the runtime DB roles (needs up-test)
	cd tests && $(DB_TEST_ENV) $(PY) -m pytest tenancy -m db

migrate: ## pg_dump backup, then alembic upgrade head (doc 18 §2)
	mkdir -p backups && $(COMPOSE) exec -T postgres pg_dump -U postgres -Fc wds > backups/pre-migrate-$$(date +%Y%m%d%H%M%S).dump
	$(COMPOSE) run --rm migrate

verify-audit: ## recompute every org's audit hash chain; non-zero exit on a break
	$(COMPOSE) exec -T backend python -m app.db.audit_cli

backup: ## pg_dump -Fc the wds database into backups/ (doc 18 §5)
	@mkdir -p backups
	@f="backups/wds-$$(date +%Y%m%d%H%M%S).dump"; \
	if $(COMPOSE) exec -T postgres pg_dump -U postgres -Fc wds > "$$f"; then \
	  echo "wrote $$f ($$(du -h "$$f" | cut -f1))"; \
	else \
	  rm -f "$$f"; echo "pg_dump FAILED — removed partial $$f"; exit 1; \
	fi

restore: ## restore make backup output: `RESTORE_CONFIRM=1 make restore DUMP=backups/wds-….dump`, then verify-audit
	@test -n "$(DUMP)" || { echo "usage: RESTORE_CONFIRM=1 make restore DUMP=backups/wds-<ts>.dump"; exit 2; }
	@test -f "$(DUMP)" || { echo "no such dump: $(DUMP)"; exit 2; }
	@test "$(RESTORE_CONFIRM)" = "1" || { \
	  echo "refusing: this DESTROYS the current wds database in compose project"; \
	  $(COMPOSE) ps --format '  {{.Name}}' | sed 's/^/  target: /'; \
	  echo "re-run with RESTORE_CONFIRM=1"; exit 2; }
	@# Validate the archive BEFORE dropping — a corrupt dump must not cost the DB.
	cat "$(DUMP)" | $(COMPOSE) exec -T postgres pg_restore -l >/dev/null \
	  || { echo "dump failed pg_restore -l (corrupt/not a -Fc archive)"; exit 1; }
	@echo "== restoring $(DUMP) — stopping writers (backend, edge-bridge)"
	$(COMPOSE) stop backend edge-bridge
	@# Fresh-DB restore (doc 18 §5): drop + recreate owned by wds_owner so
	@# pg_restore re-asserts ownership/grants; database-level CONNECT is not
	@# in the archive, so it is re-granted explicitly.
	$(COMPOSE) exec -T postgres psql -U postgres -v ON_ERROR_STOP=1 \
	  -c "DROP DATABASE wds WITH (FORCE);" \
	  -c "CREATE DATABASE wds OWNER wds_owner;"
	cat "$(DUMP)" | $(COMPOSE) exec -T postgres pg_restore -U postgres -d wds --exit-on-error
	$(COMPOSE) exec -T postgres psql -U postgres -d wds -v ON_ERROR_STOP=1 \
	  -c "REVOKE ALL ON DATABASE wds FROM PUBLIC; \
	      GRANT CONNECT ON DATABASE wds TO wds_owner, wds_app, wds_system;"
	$(COMPOSE) start backend edge-bridge
	@echo "== waiting for backend"; i=0; \
	until $(COMPOSE) exec -T backend python -c \
	  "import urllib.request;urllib.request.urlopen('http://localhost:8000/api/health',timeout=2)" \
	  >/dev/null 2>&1; do i=$$((i+1)); [ $$i -gt 60 ] && { echo "backend did not come healthy"; exit 1; }; sleep 1; done
	@# web nginx resolves upstream hostnames once at config load — a
	@# restarted/recreated backend can land on a new IP and the proxy then
	@# serves stale 502s. Reload so it re-resolves `backend`/`keycloak`.
	-$(COMPOSE) exec -T web nginx -s reload
	$(MAKE) verify-audit
	@# NOTE: restore does NOT run alembic — a dump from an older schema rev
	@# needs `$(COMPOSE) run --rm migrate` afterwards (doc 18 §2).
	@echo "== restore complete"

migrate-sqlite: ## one-time v1 SQLite→Postgres import (doc 18 §3): make migrate-sqlite [SQLITE=backend/data/app.db] [DRY=1] [DSN=…]
	$(PY) scripts/migrate_sqlite_to_pg.py --sqlite "$(SQLITE)" \
	  $(if $(DRY),--dry-run) $(if $(DSN),--dsn "$(DSN)") $(if $(ORG),--org-id "$(ORG)")

idp: ## sync the Keycloak `google`/`microsoft` IdPs with *_CLIENT_ID/SECRET (removed when unset)
	$(COMPOSE) exec -T backend python -m app.provision_idp

seed-dev: ## provision Keycloak test users + org memberships (APP_ENV=dev only)
	$(COMPOSE) exec -T backend python -m app.seed_oidc

test-integration: ## integration tests against the running stack (TLS :8883, v2 topics)
	cd tests && BASE_URL=http://localhost:$(BACKEND_PORT) MQTT_HOST=localhost MQTT_PORT=8883 \
	  MQTT_CA_FILE=../infra/certs/ca.crt \
	  WDS_TEST_APP_DSN=postgresql://wds_app:$${WDS_APP_PASSWORD:-app-dev-pass}@127.0.0.1:5433/wds \
	  $(PY) -m pytest -m integration

test-security: ## security verification sweep (v4 T13): BOLA/auth-bypass/RBAC/429/headers/WS/infra (needs up-test)
	cd tests && BASE_URL=http://localhost:$(BACKEND_PORT) WEB_URL=http://localhost:5173 \
	  KC_URL=http://localhost:8080 MQTT_HOST=localhost MQTT_PORT=8883 \
	  MQTT_CA_FILE=../infra/certs/ca.crt \
	  WDS_TEST_APP_DSN=postgresql://wds_app:$${WDS_APP_PASSWORD:-app-dev-pass}@127.0.0.1:5433/wds \
	  $(PY) -m pytest security -s

test-perf: ## performance harness (v4 T13): history p95, WS fan-out, insight eval, bundle gz, LCP (needs up-test)
	cd tests && BASE_URL=http://localhost:$(BACKEND_PORT) WEB_URL=http://localhost:5173 \
	  MQTT_HOST=localhost MQTT_PORT=8883 MQTT_CA_FILE=../infra/certs/ca.crt \
	  PLAYWRIGHT_PATH=$${PLAYWRIGHT_PATH:-/home/supawich/Desktop/adas/hmi/web/node_modules/playwright/index.mjs} \
	  $(PY) -m pytest perf -s

test: test-contract test-db test-integration ## all suites (needs up-test)

uat: ## browser UAT — needs playwright (see tests/README §e2e)
	node tests/e2e/uat.mjs

web-build: ## frontend typecheck + production bundle
	cd web && bun run build

psql: ## psql shell in the dev postgres container (PG_CONTAINER / PG_USER to override)
	@PG_TTY=1 sh scripts/psql.sh
