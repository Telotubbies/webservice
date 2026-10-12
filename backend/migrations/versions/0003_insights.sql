-- 0003 — insights: tenant-scoped findings written by the AI insight engine
-- (UI v3, doc 19). Applied by 0003_insights.py as wds_owner inside one
-- transaction. RLS shape mirrors alarm_rules in 0001_saas_schema.sql.

CREATE TABLE insights (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id),
  tag_id     uuid NOT NULL,
  kind       text CHECK (kind IN ('anomaly', 'drift', 'flatline', 'flapping')),
  severity   text CHECK (severity IN ('info', 'warning', 'critical')),
  score      real,
  state      text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed')),
  ts_start   timestamptz NOT NULL,
  ts_end     timestamptz,
  detail     jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  -- the tag must belong to the SAME org
  FOREIGN KEY (org_id, tag_id) REFERENCES tags (org_id, id) ON DELETE CASCADE
);

-- At most one open insight per (tag, kind): re-detection while one is open
-- updates the existing row, never inserts a second.
CREATE UNIQUE INDEX insights_open_uq ON insights (org_id, tag_id, kind)
  WHERE state = 'open';
CREATE INDEX insights_org_state ON insights (org_id, state, ts_start DESC);

-- Fail-closed tenant isolation — no context → no rows, writes rejected.
ALTER TABLE insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE insights FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON insights
  USING (org_id = wds_ctx_org()) WITH CHECK (org_id = wds_ctx_org());

-- wds_system (insight engine / background workers) gets full access,
-- mirroring the system_* pre-context policies in 0001.
CREATE POLICY system_insights ON insights FOR ALL TO wds_system
  USING (true) WITH CHECK (true);

-- Grants (least privilege). Nothing is owned by wds_app / wds_system.
GRANT SELECT, INSERT, UPDATE ON insights TO wds_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON insights TO wds_system;
