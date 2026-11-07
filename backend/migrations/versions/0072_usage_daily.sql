-- 0072 - daily usage snapshot (F16): the plan page shows how each metered resource moved over time.
-- One row per org, day and metric; the usage endpoint upserts today's peak.
CREATE TABLE usage_daily (
  org_id uuid NOT NULL,
  day    date NOT NULL,
  metric text NOT NULL CHECK (length(metric) BETWEEN 1 AND 60),
  value  double precision NOT NULL CHECK (value >= 0),
  PRIMARY KEY (org_id, day, metric)
);
ALTER TABLE usage_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_daily FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON usage_daily USING (org_id = wds_ctx_org()) WITH CHECK (org_id = wds_ctx_org());
GRANT SELECT, INSERT, UPDATE ON usage_daily TO wds_app;
GRANT SELECT ON usage_daily TO wds_system;
