-- 0068 - inbound ERP sync (F19): products, per-entity cursors, sync runs, and a staging
-- area for rows that cannot be mapped yet (e.g. a work center with no machine chosen).
CREATE TABLE erp_product (
  org_id uuid NOT NULL,
  id     uuid NOT NULL DEFAULT gen_random_uuid(),
  code   text NOT NULL CHECK (length(code) BETWEEN 1 AND 200),
  name   text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, code)
);
CREATE TABLE erp_sync_cursor (
  org_id        uuid NOT NULL,
  connection_id uuid NOT NULL,
  entity        text NOT NULL,
  cursor        text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, connection_id, entity),
  FOREIGN KEY (org_id, connection_id) REFERENCES erp_connections (org_id, id) ON DELETE CASCADE
);
CREATE TABLE erp_sync_run (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id        uuid NOT NULL,
  connection_id uuid NOT NULL,
  entity        text NOT NULL,
  dry_run       boolean NOT NULL DEFAULT false,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  added integer NOT NULL DEFAULT 0, updated integer NOT NULL DEFAULT 0, skipped integer NOT NULL DEFAULT 0,
  bad integer NOT NULL DEFAULT 0, staged integer NOT NULL DEFAULT 0,
  error         text CHECK (error IS NULL OR length(error) <= 2000),
  FOREIGN KEY (org_id, connection_id) REFERENCES erp_connections (org_id, id) ON DELETE CASCADE
);
CREATE TABLE erp_staging (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id        uuid NOT NULL,
  connection_id uuid NOT NULL,
  entity        text NOT NULL,
  external_id   text NOT NULL,
  payload       jsonb NOT NULL,
  reason        text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, connection_id, entity, external_id),
  FOREIGN KEY (org_id, connection_id) REFERENCES erp_connections (org_id, id) ON DELETE CASCADE
);
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['erp_product', 'erp_sync_cursor', 'erp_sync_run', 'erp_staging'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = wds_ctx_org()) '
                   'WITH CHECK (org_id = wds_ctx_org())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO wds_app', t);
  END LOOP;
END $$;
-- the scheduled Odoo pull runs as wds_system inside a per-org tenant_tx (RLS still scopes every row)
GRANT SELECT, INSERT, UPDATE, DELETE ON erp_product, erp_sync_cursor, erp_sync_run, erp_staging TO wds_system;
GRANT SELECT, INSERT, UPDATE ON erp_id_map, erp_work_order TO wds_system;
GRANT UPDATE (status, last_ok_at) ON erp_connections TO wds_system;
