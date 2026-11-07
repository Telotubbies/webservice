-- 0070 - per-site AI approval (F21). The org plan flag ai_plc_write only says AI MAY write;
-- a site writes only while it has an unrevoked arming record signed by a person.
CREATE TABLE site_ai_arming (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL,
  site_id      uuid NOT NULL,
  armed_by     uuid NOT NULL,
  armed_at     timestamptz NOT NULL DEFAULT now(),
  evidence_ref text NOT NULL CHECK (length(evidence_ref) BETWEEN 3 AND 500),   -- test report, ticket, dry-run review
  revoked_at   timestamptz,
  revoked_by   uuid,
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, site_id) REFERENCES sites (org_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX site_ai_arming_one_active ON site_ai_arming (org_id, site_id) WHERE revoked_at IS NULL;
ALTER TABLE site_ai_arming ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_ai_arming FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON site_ai_arming USING (org_id = wds_ctx_org()) WITH CHECK (org_id = wds_ctx_org());
GRANT SELECT, INSERT, UPDATE ON site_ai_arming TO wds_app;
GRANT SELECT ON site_ai_arming TO wds_system;     -- cfg builder reads it
