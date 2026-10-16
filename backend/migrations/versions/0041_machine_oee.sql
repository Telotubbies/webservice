-- 0041 - machine OEE wiring (roadmap 5.2/5.3). `machine_state_map` binds a
-- device ("machine") to the tags the OEE engine reads: `state_tag_id` holds
-- the machine state value and `states` maps raw values to
-- running|idle|stopped|fault (e.g. {"running":[1,"run"],"stopped":[0]}).
-- `count_tag_id` counts units produced, `reject_tag_id` counts bad units.
-- `stop_threshold_s` is the minimum stop duration that auto-creates a
-- downtime record. `machine_products` holds the ideal cycle time per
-- machine+product for the performance factor.

CREATE TABLE machine_state_map (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  site_id          uuid NOT NULL,
  device_id        uuid NOT NULL,
  state_tag_id     uuid NOT NULL,
  count_tag_id     uuid,
  reject_tag_id    uuid,
  states           jsonb NOT NULL DEFAULT '{}'
                   CHECK (jsonb_typeof(states) = 'object'),
  stop_threshold_s integer NOT NULL DEFAULT 300
                   CHECK (stop_threshold_s BETWEEN 30 AND 86400),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, device_id),
  FOREIGN KEY (org_id, site_id) REFERENCES sites (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, device_id) REFERENCES devices (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, state_tag_id) REFERENCES tags (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, count_tag_id) REFERENCES tags (org_id, id) ON DELETE SET NULL (count_tag_id),
  FOREIGN KEY (org_id, reject_tag_id) REFERENCES tags (org_id, id) ON DELETE SET NULL (reject_tag_id)
);
CREATE INDEX machine_state_map_site ON machine_state_map (org_id, site_id);

CREATE TABLE machine_products (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  device_id     uuid NOT NULL,
  product       text NOT NULL CHECK (length(product) BETWEEN 1 AND 80),
  ideal_cycle_s double precision NOT NULL CHECK (ideal_cycle_s > 0 AND ideal_cycle_s <= 86400),
  active        boolean NOT NULL DEFAULT true,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, device_id, product),
  FOREIGN KEY (org_id, device_id) REFERENCES devices (org_id, id) ON DELETE CASCADE
);
CREATE INDEX machine_products_dev ON machine_products (org_id, device_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['machine_state_map', 'machine_products'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = wds_ctx_org()) WITH CHECK (org_id = wds_ctx_org())', t);
  END LOOP;
END $$;

-- The downtime sweep (wds_system inside tenant_tx) reads both tables.
GRANT SELECT, INSERT, UPDATE, DELETE ON machine_state_map, machine_products TO wds_app;
GRANT SELECT ON machine_state_map, machine_products TO wds_system;
