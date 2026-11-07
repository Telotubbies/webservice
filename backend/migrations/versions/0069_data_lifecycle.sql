-- 0069 - data lifecycle (F20): retention per data class, archive manifest, quality-aware
-- rollups (n_bad), and the deletion certificate written when a tenant is purged.
-- (sites.data_origin already landed in 0066.)

CREATE TABLE retention_policy (            -- platform-wide defaults, no tenant data
  data_class   text PRIMARY KEY,
  default_days integer NOT NULL CHECK (default_days >= 1),
  enabled      boolean NOT NULL DEFAULT true
);
INSERT INTO retention_policy(data_class, default_days) VALUES
  ('alarms_cleared', 365), ('downtimes', 730), ('vision_events', 90), ('edge_logs', 30),
  ('outbox_sent', 30), ('org_exports_expired', 7);
GRANT SELECT ON retention_policy TO wds_app, wds_system;

CREATE TABLE archive_manifest (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  month      date NOT NULL,
  path       text NOT NULL,
  row_count  bigint NOT NULL,
  sha256     text NOT NULL CHECK (length(sha256) = 64),
  verified_at timestamptz NOT NULL,        -- read back and re-hashed before this was set
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, month)
);
ALTER TABLE archive_manifest ENABLE ROW LEVEL SECURITY;
ALTER TABLE archive_manifest FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON archive_manifest USING (org_id = wds_ctx_org()) WITH CHECK (org_id = wds_ctx_org());
GRANT SELECT ON archive_manifest TO wds_app;
GRANT SELECT, INSERT, UPDATE ON archive_manifest TO wds_system;

-- Rollups: min/max/sum/count now cover only q='good'; non-good samples are counted apart,
-- so a bad reading no longer moves an average and nothing is thrown away.
ALTER TABLE tag_rollup_1m ADD COLUMN n_bad integer NOT NULL DEFAULT 0;
ALTER TABLE tag_rollup_1h ADD COLUMN n_bad integer NOT NULL DEFAULT 0;

-- Written just before a purge removes the org; survives it (no FK, not tenant-scoped).
CREATE TABLE org_deletion_certificate (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id      uuid NOT NULL,
  org_name    text NOT NULL,
  deleted_at  timestamptz,
  purged_at   timestamptz NOT NULL DEFAULT now(),
  row_counts  jsonb NOT NULL,              -- rows held per org table just before the purge
  audit_tip   text,                         -- last audit hash of the org's chain
  backup_note text NOT NULL,
  sha256      text NOT NULL CHECK (length(sha256) = 64)
);
GRANT SELECT, INSERT ON org_deletion_certificate TO wds_system;
-- org_id table, so RLS is forced; the purge writes it as wds_system outside any org context.
ALTER TABLE org_deletion_certificate ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_deletion_certificate FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON org_deletion_certificate
  USING (org_id = wds_ctx_org()) WITH CHECK (org_id = wds_ctx_org());
CREATE POLICY system_all ON org_deletion_certificate FOR ALL TO wds_system
  USING (wds_ctx_org() IS NULL OR org_id = wds_ctx_org())
  WITH CHECK (wds_ctx_org() IS NULL OR org_id = wds_ctx_org());
