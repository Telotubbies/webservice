-- 0024 - per-org inference usage metering (roadmap 9.5/9.11, plan limits in §10).
-- One row per (org, day, placement); the ingest worker upserts frames and
-- gpu_seconds for cloud-placed inference (wds_system inside tenant_tx).
-- Applied by 0024_inference_usage.py as wds_owner in one transaction.

CREATE TABLE inference_usage (
  org_id      uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  day         date NOT NULL,
  placement   text NOT NULL CHECK (placement IN ('edge', 'cloud')),
  frames      bigint NOT NULL DEFAULT 0 CHECK (frames >= 0),
  gpu_seconds double precision NOT NULL DEFAULT 0 CHECK (gpu_seconds >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, day, placement)
);

ALTER TABLE inference_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE inference_usage FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inference_usage
  USING (org_id = wds_ctx_org()) WITH CHECK (org_id = wds_ctx_org());

CREATE POLICY system_lookup ON inference_usage FOR SELECT TO wds_system USING (true);

GRANT SELECT ON inference_usage TO wds_app;
GRANT SELECT, INSERT, UPDATE ON inference_usage TO wds_system;
