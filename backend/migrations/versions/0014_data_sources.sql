-- 0014 - data sources (PLC / server connections owned by an edge), tag
-- addressing, edge config versioning, and edge enrollment codes.
-- Applied by 0014_data_sources.py as wds_owner in one transaction.

CREATE TABLE data_sources (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  site_id       uuid NOT NULL,
  edge_id       uuid NOT NULL,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  protocol      text NOT NULL CHECK (protocol IN ('sim', 'modbus', 's7', 'opcua')),
  connection    jsonb NOT NULL DEFAULT '{}',          -- protocol-specific; no secrets
  secret_enc    bytea,                                -- AES-GCM encrypted secrets
  poll_ms       integer NOT NULL DEFAULT 1000 CHECK (poll_ms BETWEEN 100 AND 60000),
  enabled       boolean NOT NULL DEFAULT true,
  status        text NOT NULL DEFAULT 'unknown' CHECK (status IN ('unknown', 'ok', 'error')),
  status_detail text,
  status_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, edge_id, name),
  FOREIGN KEY (org_id, site_id) REFERENCES sites (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, site_id, edge_id) REFERENCES edges (org_id, site_id, id) ON DELETE CASCADE
);
CREATE INDEX data_sources_edge ON data_sources (org_id, edge_id);

ALTER TABLE tags
  ADD COLUMN source_id    uuid,
  ADD COLUMN address      jsonb,
  ADD COLUMN scale        double precision,
  ADD COLUMN offset_value double precision,
  ADD COLUMN deadband     double precision,
  ADD CONSTRAINT tags_source_fk FOREIGN KEY (org_id, source_id)
    REFERENCES data_sources (org_id, id) ON DELETE RESTRICT;
CREATE INDEX tags_source ON tags (org_id, source_id) WHERE source_id IS NOT NULL;

ALTER TABLE edges
  ADD COLUMN config_version bigint NOT NULL DEFAULT 0,
  ADD COLUMN config_applied bigint,
  ADD COLUMN config_error   text;

CREATE TABLE edge_enrollments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL,
  edge_id    uuid NOT NULL,
  code_hash  text NOT NULL UNIQUE,                   -- sha256 hex; never the code
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, edge_id) REFERENCES edges (org_id, id) ON DELETE CASCADE
);
CREATE INDEX edge_enrollments_edge ON edge_enrollments (org_id, edge_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['data_sources', 'edge_enrollments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = wds_ctx_org()) '
                   'WITH CHECK (org_id = wds_ctx_org())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO wds_app', t);
  END LOOP;
END $$;

-- cfg publisher reads all sources pre-context; enroll path is pre-auth.
CREATE POLICY system_ds_lookup ON data_sources FOR SELECT TO wds_system USING (true);
GRANT SELECT ON data_sources TO wds_system;
CREATE POLICY system_enroll_read ON edge_enrollments FOR SELECT TO wds_system USING (true);
CREATE POLICY system_enroll_use ON edge_enrollments FOR UPDATE TO wds_system USING (true) WITH CHECK (true);
GRANT SELECT, UPDATE ON edge_enrollments TO wds_system;

-- Data step. wds_owner is not BYPASSRLS, so the backfill must lift FORCE on the
-- tables it touches (owner is then exempt); restored immediately after.
ALTER TABLE tags NO FORCE ROW LEVEL SECURITY;
ALTER TABLE edges NO FORCE ROW LEVEL SECURITY;
ALTER TABLE data_sources NO FORCE ROW LEVEL SECURITY;

-- every edge that already owns tags gets one 'Simulator' source.
INSERT INTO data_sources (org_id, site_id, edge_id, name, protocol)
SELECT DISTINCT t.org_id, t.site_id, t.edge_id, 'Simulator', 'sim'
FROM tags t WHERE t.edge_id IS NOT NULL;

UPDATE tags t SET
  source_id = ds.id,
  address = CASE t.path
    WHEN 'sort/line1/motor1/running'     THEN '{"behavior":"state","initial":false}'::jsonb
    WHEN 'sort/line1/motor1/speed_sp'    THEN '{"behavior":"state","initial":45.0}'::jsonb
    WHEN 'sort/line1/conv1/speed_mps'    THEN '{"behavior":"conv_speed","initial":0.0}'::jsonb
    WHEN 'sort/line1/conv1/temp_c'       THEN '{"behavior":"conv_temp","initial":28.0}'::jsonb
    WHEN 'sort/line1/bin1/level_pct'     THEN '{"behavior":"bin_level","initial":20.0}'::jsonb
    WHEN 'sort/vision/cam1/gravel_ratio' THEN '{"behavior":"random_walk","initial":0.3}'::jsonb
    ELSE '{"behavior":"random_walk"}'::jsonb
  END
FROM data_sources ds
WHERE ds.org_id = t.org_id AND ds.edge_id = t.edge_id AND ds.name = 'Simulator'
  AND t.source_id IS NULL;

UPDATE edges e SET config_version = 1
WHERE EXISTS (SELECT 1 FROM data_sources ds WHERE ds.org_id = e.org_id AND ds.edge_id = e.id);

ALTER TABLE tags FORCE ROW LEVEL SECURITY;
ALTER TABLE edges FORCE ROW LEVEL SECURITY;
ALTER TABLE data_sources FORCE ROW LEVEL SECURITY;
