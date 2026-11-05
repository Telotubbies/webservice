-- 0037 - owner-requested org data exports (roadmap §12 8.2): a queued job
-- zips the org's data to disk; the row tracks status and the download lives
-- until expires_at (7 days), then the sweeper deletes the file.
-- Applied by 0037_org_exports.py as wds_owner in one transaction.

CREATE TABLE org_exports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued', 'running', 'done', 'failed')),
  file_path    text,
  size_bytes   bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  error        text CHECK (error IS NULL OR length(error) <= 2000),
  requested_by uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  ready_at     timestamptz,
  expires_at   timestamptz
);
CREATE INDEX org_exports_org ON org_exports (org_id, created_at DESC);

ALTER TABLE org_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_exports FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON org_exports
  USING (org_id = wds_ctx_org()) WITH CHECK (org_id = wds_ctx_org());
CREATE POLICY system_all ON org_exports FOR ALL TO wds_system
  USING (true) WITH CHECK (true);

-- wds_app only queues a row (id, org_id, requested_by); status/file_path/
-- ready_at/expires_at are written later by the export worker as wds_system.
GRANT SELECT, INSERT (id, org_id, requested_by) ON org_exports TO wds_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON org_exports TO wds_system;
