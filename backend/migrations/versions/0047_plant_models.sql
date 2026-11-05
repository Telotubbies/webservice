-- 0047 - plant models: an uploaded .glb of the plant plus the operator-made
-- mapping from model nodes to live equipment (kind + tag bindings). One
-- model per site is "active" and drives the 3D twin and the derived 2D view.
-- Applied by 0047_plant_models.py as wds_owner in one transaction.

CREATE TABLE plant_models (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  site_id     uuid NOT NULL,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  filename    text NOT NULL CHECK (length(filename) BETWEEN 1 AND 255),
  size_bytes  bigint NOT NULL CHECK (size_bytes > 0),
  sha256      text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_key text NOT NULL,
  node_count  integer NOT NULL CHECK (node_count >= 0),
  active      boolean NOT NULL DEFAULT false,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, site_id) REFERENCES sites (org_id, id) ON DELETE CASCADE
);
CREATE INDEX plant_models_site ON plant_models (org_id, site_id, created_at DESC);
-- at most one active model per site
CREATE UNIQUE INDEX plant_models_one_active ON plant_models (org_id, site_id) WHERE active;

-- One row per piece of equipment. `nodes` are glTF node indices (stable for a
-- given file); `bindings` maps a role of the kind (run, speed, level, ...) to a
-- tag path of the same site. Tag paths are validated by the API, not by FK:
-- a tag deleted later leaves a dangling binding that the UI shows as unbound.
CREATE TABLE plant_parts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL,
  model_id   uuid NOT NULL,
  label      text NOT NULL CHECK (length(label) BETWEEN 1 AND 120),
  kind       text NOT NULL CHECK (kind IN
               ('motor', 'conveyor', 'vessel', 'valve', 'pump', 'mixer', 'indicator')),
  nodes      integer[] NOT NULL CHECK (cardinality(nodes) BETWEEN 1 AND 500),
  bindings   jsonb NOT NULL DEFAULT '{}',
  sort       integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, model_id, label),
  FOREIGN KEY (org_id, model_id) REFERENCES plant_models (org_id, id) ON DELETE CASCADE
);
CREATE INDEX plant_parts_model ON plant_parts (org_id, model_id, sort);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['plant_models', 'plant_parts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = wds_ctx_org()) '
                   'WITH CHECK (org_id = wds_ctx_org())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO wds_app', t);
  END LOOP;
END $$;
