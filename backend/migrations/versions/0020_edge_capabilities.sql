-- 0020 - edge-reported capabilities for the model-test/gateway UX (roadmap 9.11,
-- plan M1-05 Task 4). Written only from the edge's own vision/caps topic by the
-- ingest worker (wds_system inside tenant_tx); read by members via wds_app.
-- Applied by 0020_edge_capabilities.py as wds_owner in one transaction.

CREATE TABLE edge_capabilities (
  org_id      uuid NOT NULL,
  edge_id     uuid PRIMARY KEY,
  reported_at timestamptz NOT NULL DEFAULT now(),
  cpu_cores   integer CHECK (cpu_cores > 0),
  ram_mb      bigint CHECK (ram_mb >= 0),
  device      text CHECK (device IS NULL OR length(device) <= 80),
  providers   jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(providers) = 'array'),
  loaded      jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(loaded) = 'array'),
  FOREIGN KEY (org_id, edge_id) REFERENCES edges (org_id, id) ON DELETE CASCADE
);

-- Fail-closed tenant isolation — no context → no rows, writes rejected.
ALTER TABLE edge_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE edge_capabilities FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON edge_capabilities
  USING (org_id = wds_ctx_org()) WITH CHECK (org_id = wds_ctx_org());

-- wds_system pre-context lookup + trusted ingest (writes run inside
-- tenant_tx, so tenant_isolation's WITH CHECK gates them — same shape as
-- edge_identities in 0004).
CREATE POLICY system_lookup ON edge_capabilities
  FOR SELECT TO wds_system USING (true);

GRANT SELECT ON edge_capabilities TO wds_app;
GRANT SELECT, INSERT, UPDATE ON edge_capabilities TO wds_system;
