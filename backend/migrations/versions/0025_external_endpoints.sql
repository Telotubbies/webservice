-- 0025 - external model endpoints (roadmap 9.6, 9.11): a model of
-- kind='external' calls a hosted inference service instead of a file; the API
-- key is sealed in key_enc (datasources/secretbox) and is write-only.
-- Applied by 0025_external_endpoints.py as wds_owner in one transaction.

ALTER TABLE vision_models
  ADD COLUMN kind text NOT NULL DEFAULT 'file' CHECK (kind IN ('file', 'external'));

CREATE TABLE external_endpoints (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL,
  model_id   uuid NOT NULL,                             -- 1:1 with a kind='external' model
  provider   text NOT NULL CHECK (provider IN ('roboflow', 'hf', 'generic')),
  url        text NOT NULL CHECK (length(url) BETWEEN 8 AND 1000),
  key_enc    bytea,                                     -- AES-GCM sealed; write-only
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, model_id),
  FOREIGN KEY (org_id, model_id) REFERENCES vision_models (org_id, id) ON DELETE CASCADE
);

ALTER TABLE external_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_endpoints FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON external_endpoints
  USING (org_id = wds_ctx_org()) WITH CHECK (org_id = wds_ctx_org());

-- key_enc is write-only for wds_app: the sealed provider key is opened only
-- by the cfg publisher running as wds_system (system_lookup below). Column
-- grants keep it out of every app-role read path.
GRANT INSERT, UPDATE, DELETE ON external_endpoints TO wds_app;
GRANT SELECT (id, org_id, model_id, provider, url, created_by, created_at,
              updated_at) ON external_endpoints TO wds_app;

-- cfg build (wds_system) opens the key to hand it to the gateway
CREATE POLICY system_lookup ON external_endpoints FOR SELECT TO wds_system USING (true);
GRANT SELECT ON external_endpoints TO wds_system;
