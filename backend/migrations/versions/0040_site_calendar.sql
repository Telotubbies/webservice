-- 0040 - site working calendar (roadmap 5.1): days a site does not run at
-- all (holidays, planned shutdowns). OEE availability subtracts these from
-- planned time; report generation skips them. One row per site+day.

CREATE TABLE nonworking_days (
  org_id  uuid NOT NULL,
  site_id uuid NOT NULL,
  day     date NOT NULL,
  reason  text NOT NULL DEFAULT '' CHECK (length(reason) <= 200),
  PRIMARY KEY (site_id, day),
  FOREIGN KEY (org_id, site_id) REFERENCES sites (org_id, id) ON DELETE CASCADE
);
CREATE INDEX nonworking_days_org ON nonworking_days (org_id, day);

ALTER TABLE nonworking_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE nonworking_days FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON nonworking_days
  USING (org_id = wds_ctx_org()) WITH CHECK (org_id = wds_ctx_org());

GRANT SELECT, INSERT, UPDATE, DELETE ON nonworking_days TO wds_app;
GRANT SELECT ON nonworking_days TO wds_system;
