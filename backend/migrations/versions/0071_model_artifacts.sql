-- 0071 - model provenance (F21): what was uploaded (.pt) and what was produced (.onnx), with
-- hashes, so a converted model can be traced to the exact checkpoint that was scanned.
CREATE TABLE model_artifacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  version_id    uuid NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('pt', 'onnx')),
  sha256        text NOT NULL CHECK (length(sha256) = 64),
  source_sha256 text CHECK (source_sha256 IS NULL OR length(source_sha256) = 64),   -- onnx: the pt it came from
  scan_result   text NOT NULL CHECK (scan_result IN ('clean', 'rescanned_clean', 'refused')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, version_id, kind),
  FOREIGN KEY (org_id, version_id) REFERENCES vision_model_versions (org_id, id) ON DELETE CASCADE
);
ALTER TABLE model_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_artifacts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON model_artifacts USING (org_id = wds_ctx_org()) WITH CHECK (org_id = wds_ctx_org());
GRANT SELECT, INSERT ON model_artifacts TO wds_app, wds_system;
