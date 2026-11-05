-- 0045 - logs shipped from the edge (roadmap Phase 4 "Logs — make real").
-- The edge publishes batches on v2/{org}/{site}/{edge}/logs; the ingest
-- worker writes them via wds_system inside tenant_tx (same trust shape as
-- edge_capabilities in 0020 — topic-derived identity only, never payload).
-- Members read via wds_app. Retention per plan is a later migration; the
-- table carries received_at so a prune job can age rows out.
-- Applied by 0045_edge_logs.py as wds_owner in one transaction.

CREATE TABLE edge_logs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id      uuid NOT NULL,
  site_id     uuid NOT NULL,
  edge_id     uuid NOT NULL,
  ts          timestamptz NOT NULL,                    -- edge clock, as sent
  level       text NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
  source      text NOT NULL CHECK (length(source) BETWEEN 1 AND 80),
  msg         text NOT NULL CHECK (length(msg) BETWEEN 1 AND 2000),
  received_at timestamptz NOT NULL DEFAULT now(),      -- server clock (retention)
  FOREIGN KEY (org_id, site_id, edge_id) REFERENCES edges (org_id, site_id, id) ON DELETE CASCADE
);
CREATE INDEX edge_logs_org_ts  ON edge_logs (org_id, ts DESC);
CREATE INDEX edge_logs_edge_ts ON edge_logs (org_id, edge_id, ts DESC);
CREATE INDEX edge_logs_level   ON edge_logs (org_id, level, ts DESC);

-- Fail-closed tenant isolation — no context -> no rows, writes rejected.
ALTER TABLE edge_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE edge_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON edge_logs
  USING (org_id = wds_ctx_org()) WITH CHECK (org_id = wds_ctx_org());

-- wds_system pre-context lookup (ingest resolves topic ids before context
-- exists) — same shape as system_edge_lookup / edge_capabilities.
CREATE POLICY system_lookup ON edge_logs
  FOR SELECT TO wds_system USING (true);

GRANT SELECT ON edge_logs TO wds_app;
GRANT SELECT, INSERT ON edge_logs TO wds_system;
