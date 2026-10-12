# webservice — one command surface. `make` with no target lists them.
COMPOSE := docker compose -f docker-compose.yml
COMPOSE_TEST := docker compose -f docker-compose.yml -f docker-compose.test.yml
PY ?= python3
DB_TEST_ENV := WDS_TEST_APP_DSN=postgresql://wds_app:$${WDS_APP_PASSWORD:-app-dev-pass}@127.0.0.1:5433/wds \
  WDS_TEST_SYSTEM_DSN=postgresql://wds_system:$${WDS_SYSTEM_PASSWORD:-system-dev-pass}@127.0.0.1:5433/wds \
  WDS_TEST_SUPER_DSN=postgresql://postgres:$${POSTGRES_SUPERUSER_PASSWORD:-postgres-dev-pass}@127.0.0.1:5433/wds

.PHONY: help up up-test down ps logs build clean secrets test test-contract test-db test-integration uat web-build migrate verify-audit

help: ## show this
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  %-20s %s\n", $$1, $$2}'

secrets: ## regenerate broker credentials (infra/passwd — gitignored)
	./infra/gen-passwd.sh

up: ## build + start the full stack, wait for health
	$(COMPOSE) up -d --build --wait

down: ## stop the stack (data volume survives)
	$(COMPOSE) down

ps: ## service status
	$(COMPOSE) ps

logs: ## tail all service logs
	$(COMPOSE) logs -f --tail=100

build: ## rebuild images without starting
	$(COMPOSE) build

clean: ## stop the stack AND delete the sqlite volume (fresh DB)
	$(COMPOSE) down -v

test-contract: ## contract/unit tests — no services needed
	cd tests && python -m pytest -m "not integration"

up-test: ## start the stack with the test overlay (Postgres on 127.0.0.1:5433)
	$(COMPOSE_TEST) up -d --build --wait

test-db: ## tenant-isolation / RLS / audit gate as the runtime DB roles (needs up-test)
	cd tests && $(DB_TEST_ENV) $(PY) -m pytest tenancy -m db

migrate: ## pg_dump backup, then alembic upgrade head (doc 18 §2)
	mkdir -p backups && $(COMPOSE) exec -T postgres pg_dump -U postgres -Fc wds > backups/pre-migrate-$$(date +%Y%m%d%H%M%S).dump
	$(COMPOSE) run --rm migrate

verify-audit: ## recompute every org's audit hash chain; non-zero exit on a break
	$(COMPOSE) exec -T backend python -m app.db.audit_cli

test-integration: ## integration tests against the running stack
	cd tests && BASE_URL=http://localhost:8000 MQTT_HOST=localhost \
	  python -m pytest -m integration

test: test-contract test-db test-integration ## all suites (needs up-test)

uat: ## browser UAT — needs playwright (see tests/README §e2e)
	node tests/e2e/uat.mjs

web-build: ## frontend typecheck + production bundle
	cd web && bun run build
