-- 0018 - vision model registry, camera pins, class presets (roadmap 9.3, 9.4, 9.11).
-- Applied by 0018_vision_models.py as wds_owner in one transaction.

CREATE TABLE vision_models (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  task       text NOT NULL CHECK (task IN ('detect', 'segment')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, name)
);

CREATE TABLE vision_model_versions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL,
  model_id            uuid NOT NULL,
  version             integer NOT NULL CHECK (version >= 1),
  status              text NOT NULL CHECK (status IN ('processing', 'draft', 'active', 'archived', 'failed')),
  source_format       text NOT NULL CHECK (source_format IN ('onnx', 'pt')),
  artifact_key        text,
  sha256              text CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes          bigint,
  imgsz               integer,
  stride              integer,
  classes             jsonb,                       -- ["person", ...] by class id; NULL until known
  ultralytics_version text,
  opset               integer,
  notes               text,
  failure_reason      text,
  license_attested_by uuid,
  license_attested_at timestamptz,
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (model_id, version),
  CHECK (status <> 'active' OR license_attested_at IS NOT NULL),
  FOREIGN KEY (org_id, model_id) REFERENCES vision_models (org_id, id) ON DELETE CASCADE
);
CREATE INDEX vision_model_versions_model ON vision_model_versions (org_id, model_id);

CREATE TABLE camera_models (
  org_id           uuid NOT NULL,
  camera_id        uuid NOT NULL,
  model_version_id uuid NOT NULL,
  class_config     jsonb NOT NULL DEFAULT '{}',
  placement        text NOT NULL DEFAULT 'auto' CHECK (placement IN ('auto', 'edge', 'cloud')),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (camera_id),
  FOREIGN KEY (org_id, camera_id) REFERENCES cameras (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, model_version_id) REFERENCES vision_model_versions (org_id, id) ON DELETE RESTRICT
);
CREATE INDEX camera_models_version ON camera_models (org_id, model_version_id);

CREATE TABLE class_presets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL,
  model_id     uuid NOT NULL,
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  class_config jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, model_id, name),
  FOREIGN KEY (org_id, model_id) REFERENCES vision_models (org_id, id) ON DELETE CASCADE
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['vision_models', 'vision_model_versions', 'camera_models', 'class_presets'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = wds_ctx_org()) '
                   'WITH CHECK (org_id = wds_ctx_org())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO wds_app', t);
  END LOOP;
  -- the cfg publisher (wds_system) reads what it must hand to a gateway
  FOREACH t IN ARRAY ARRAY['vision_model_versions', 'camera_models'] LOOP
    EXECUTE format('CREATE POLICY system_lookup ON %I FOR SELECT TO wds_system USING (true)', t);
    EXECUTE format('GRANT SELECT ON %I TO wds_system', t);
  END LOOP;
END $$;

-- the model-download route (gateway capability URL) looks a version up pre-context
GRANT SELECT ON vision_models TO wds_system;
CREATE POLICY system_lookup ON vision_models FOR SELECT TO wds_system USING (true);
-- converter results are ingested by a background task running as wds_system
GRANT UPDATE (status, artifact_key, sha256, size_bytes, imgsz, stride, classes, ultralytics_version,
              opset, failure_reason) ON vision_model_versions TO wds_system;
