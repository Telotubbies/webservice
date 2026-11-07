-- 0066 - integration layer (F18): ERP connections, id map, work-order reference,
-- the transactional outbox, scoped API keys, and sites.data_origin so demo or
-- simulated data can never reach an ERP or an export by accident.
-- Applied by 0066_integration_layer.py as wds_owner in one transaction.

ALTER TABLE sites ADD COLUMN data_origin text NOT NULL DEFAULT 'production'
  CHECK (data_origin IN ('production', 'demo', 'simulated', 'test'));
-- sites already fed by the built-in simulator are not production data
UPDATE sites SET data_origin = 'simulated'
 WHERE id IN (SELECT site_id FROM edges WHERE adapter = 'sim');

ALTER TABLE api_keys ADD COLUMN scopes text[] NOT NULL DEFAULT '{}'
  CHECK (scopes <@ ARRAY['read:production', 'write:orders']::text[]);   -- never a PLC-control scope

CREATE TABLE erp_connections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('odoo', 'csv', 'webhook')),
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  config      jsonb NOT NULL DEFAULT '{}',           -- url, db ... never a secret
  secret_enc  bytea,                                  -- sealed (datasources/secretbox), write-only
  enabled     boolean NOT NULL DEFAULT true,
  allow_non_production boolean NOT NULL DEFAULT false,  -- ERP sandbox testing only
  status      text NOT NULL DEFAULT 'new',
  last_ok_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id)
);

CREATE TABLE erp_id_map (
  org_id        uuid NOT NULL,
  connection_id uuid NOT NULL,
  entity        text NOT NULL CHECK (entity IN ('product', 'work_order', 'work_center', 'reason')),
  external_id   text NOT NULL,
  local_id      uuid NOT NULL,
  external_ver  text,
  inactive      boolean NOT NULL DEFAULT false,       -- gone from the ERP: flag, never delete
  synced_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, connection_id, entity, external_id),
  UNIQUE (org_id, connection_id, entity, local_id),
  FOREIGN KEY (org_id, connection_id) REFERENCES erp_connections (org_id, id) ON DELETE CASCADE
);

CREATE TABLE erp_work_order (
  org_id        uuid NOT NULL,
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  code          text NOT NULL,
  product_code  text NOT NULL,
  qty_planned   numeric,
  due_at        timestamptz,
  status        text NOT NULL,
  device_id     uuid,
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, code)
);

CREATE TABLE integration_outbox (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id          uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  connection_id   uuid NOT NULL,                      -- the target: a webhook endpoint id
  event_type      text NOT NULL,
  idempotency_key text NOT NULL,
  payload         jsonb NOT NULL,
  payload_ver     integer NOT NULL DEFAULT 1,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'dead')),
  attempts        integer NOT NULL DEFAULT 0,
  next_try_at     timestamptz NOT NULL DEFAULT now(),
  last_code       integer,
  last_error      text CHECK (last_error IS NULL OR length(last_error) <= 2000),
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  UNIQUE (org_id, connection_id, idempotency_key)
);
CREATE INDEX integration_outbox_due ON integration_outbox (next_try_at) WHERE status = 'pending';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['erp_connections', 'erp_id_map', 'erp_work_order', 'integration_outbox'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = wds_ctx_org()) '
                   'WITH CHECK (org_id = wds_ctx_org())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO wds_app', t);
  END LOOP;
END $$;
-- the dispatcher runs as wds_system inside a per-org tenant_tx
GRANT SELECT, INSERT, UPDATE ON integration_outbox TO wds_system;
CREATE POLICY system_all ON integration_outbox FOR ALL TO wds_system
  USING (wds_ctx_org() IS NULL OR org_id = wds_ctx_org())
  WITH CHECK (wds_ctx_org() IS NULL OR org_id = wds_ctx_org());
GRANT SELECT ON erp_connections TO wds_system;
