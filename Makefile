# webservice — one command surface. `make` with no target lists them.
COMPOSE := docker compose -f docker-compose.yml
COMPOSE_TEST := docker compose -f docker-compose.yml -f docker-compose.test.yml
PY ?= python3
DB_TEST_ENV := WDS_TEST_APP_DSN=postgresql://wds_app:$${WDS_APP_PASSWORD:-app-dev-pass}@127.0.0.1:5433/wds \
  WDS_TEST_SYSTEM_DSN=postgresql://wds_system:$${WDS_SYSTEM_PASSWORD:-system-dev-pass}@127.0.0.1:5433/wds \
  WDS_TEST_SUPER_DSN=postgresql://postgres:$${POSTGRES_SUPERUSER_PASSWORD:-postgres-dev-pass}@127.0.0.1:5433/wds

.PHONY: help up up-test down ps logs build clean secrets certs test test-contract test-db test-integration uat web-build migrate verify-audit seed-dev

help: ## show this
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  %-20s %s\n", $$1, $$2}'

secrets: ## generate MQTT identity secrets (infra/secrets — gitignored)
	./infra/gen-secrets.sh

certs: ## generate the dev CA + broker TLS cert (infra/certs — gitignored)
	./infra/gen-certs.sh

up: secrets certs ## build + start the full stack, wait for health (+ Keycloak seed in dev)
	$(COMPOSE) up -d --build --wait
	@if [ "$${APP_ENV:-dev}" = "dev" ]; then $(MAKE) seed-dev; fi

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

seed-dev: ## provision Keycloak test users + org memberships (APP_ENV=dev only)
	$(COMPOSE) exec -T backend python -m app.seed_oidc

test-integration: ## integration tests against the running stack (TLS :8883, v2 topics)
	cd tests && BASE_URL=http://localhost:8000 MQTT_HOST=localhost MQTT_PORT=8883 \
	  MQTT_CA_FILE=../infra/certs/ca.crt \
	  WDS_TEST_APP_DSN=postgresql://wds_app:$${WDS_APP_PASSWORD:-app-dev-pass}@127.0.0.1:5433/wds \
	  python -m pytest -m integration

test: test-contract test-db test-integration ## all suites (needs up-test)

uat: ## browser UAT — needs playwright (see tests/README §e2e)
	node tests/e2e/uat.mjs

web-build: ## frontend typecheck + production bundle
	cd web && bun run build
