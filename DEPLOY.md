# Deploying WDS (production)

Written from the compose files and scripts in this repo. The prod overlay
parses (`docker compose ... config` exits 0); a full deploy on a real host has
not been run yet, so treat the first one as a rehearsal.

## 1. Prerequisites

- A Linux host with Docker Compose v2 and `make`.
- DNS: `console.<domain>` -> the host's HTTPS proxy (Traefik/Dokploy, TLS ends
  there, target service `web` port 80); `mqtt.<domain>` -> the host, TCP 8883.
- An S3-compatible bucket for backups (`deploy/garage/` has a Garage setup).

## 2. Configure

```bash
cp .env.prod.example .env      # fill every <...>; PUBLIC_URL=https://console.<domain>
PROD=1 SECRETS_DIR=../files/secrets ./infra/gen-secrets.sh
MQTT_PUBLIC_HOST=mqtt.<domain> CERTS_DIR=../files/certs ./infra/gen-certs.sh
SECRETS_DIR=../files/secrets make secrets-check   # must pass: no dev defaults left
```

Secrets are files mounted at `/run/secrets/*`, never environment variables.
Keep `SECRETS_DIR` and `CERTS_DIR` outside the git checkout.

## 3. Deploy

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build --wait
```

Order is enforced by healthchecks: postgres -> `migrate` (Alembic as
`wds_owner`) -> backend. `kc-sync` points the Keycloak `wds-web` client at
`PUBLIC_URL` and syncs the Google IdP on every deploy. The demo
`edge-bridge` only starts with `--profile demo`.

## 4. Verify

```bash
curl -fsS https://console.<domain>/api/health
docker compose ps            # backend + keycloak + mosquitto healthy, migrate/kc-sync exited 0
make verify-audit            # recomputes every org's audit hash chain
```

Then sign in, create an organisation, enroll a gateway and confirm live values.

## 5. Backup and restore

The `backup` service dumps to S3 every `BACKUP_INTERVAL_S` (default 24 h) and
keeps `BACKUP_KEEP_DAYS` (default 30).

```bash
make backup                                              # manual pg_dump -Fc into backups/
RESTORE_CONFIRM=1 make restore DUMP=backups/wds-<ts>.dump
make verify-audit                                        # always run after a restore
```

Practise a restore into a scratch environment before the first customer.

## 6. Upgrade and rollback

```bash
git pull
make migrate                 # pg_dump first, then alembic upgrade head
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build --wait
```

Rollback = redeploy the previous revision and restore the pre-migrate dump.
Migration downgrades are not a data-recovery path. Never edit an applied
migration; add a new revision (ADR-0001).

**Migration 0052 (historian)** rewrites `tag_history` into monthly partitions and
copies every row, so it takes about a minute per few million samples and needs
the free disk space of the table once more while it runs. It has no downgrade:
the dump `make migrate` takes first is the way back. Postgres image and volume
are unchanged (ADR-0002). Afterwards the backend refreshes the 1-minute and
1-hour rollups every `ROLLUP_REFRESH_S` seconds (default 60) and creates the next
three months of partitions at start-up and daily.

## 7. Not covered here

Billing and payment, legal pages, and per-tenant retention are tracked in
`docs/saas-readiness.md`.
