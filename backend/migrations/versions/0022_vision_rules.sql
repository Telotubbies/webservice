-- 0022 - vision rules (roadmap 9.7, 9.11). Written ONLY by the backend and
-- delivered to the gateway inside cfg cameras[].rules; the edge evaluates
-- them next to its model server behind a local command gate.
-- Applied by 0022_vision_rules.py as wds_owner in one transaction.

CREATE TABLE vision_rules (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL,
  camera_id             uuid NOT NULL,
  model_version_id      uuid,                          -- pinned-at-write snapshot; nullable
  name                  text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  enabled               boolean NOT NULL DEFAULT true,
  dry_run               boolean NOT NULL DEFAULT true, -- new rules never act until reviewed
  allow_cloud_write     boolean NOT NULL DEFAULT false,-- 9.5 PLC safety, per-rule switch
  conditions            jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(conditions) = 'object'),
  actions               jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(actions) = 'array'),
  offline_write_window_s integer                        -- NULL = org default (plan_limits)
                        CHECK (offline_write_window_s IS NULL
                               OR offline_write_window_s BETWEEN 0 AND 86400),
  created_by            uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, camera_id, name),
  FOREIGN KEY (org_id, camera_id) REFERENCES cameras (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, model_version_id) REFERENCES vision_model_versions (org_id, id)
    ON DELETE SET NULL
);
CREATE INDEX vision_rules_camera ON vision_rules (org_id, camera_id);

-- Fail-closed tenant isolation — no context → no rows, writes rejected.
ALTER TABLE vision_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE vision_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON vision_rules
  USING (org_id = wds_ctx_org()) WITH CHECK (org_id = wds_ctx_org());

GRANT SELECT, INSERT, UPDATE, DELETE ON vision_rules TO wds_app;

-- the cfg publisher (wds_system) reads rules to hand them to the gateway
CREATE POLICY system_lookup ON vision_rules FOR SELECT TO wds_system USING (true);
GRANT SELECT ON vision_rules TO wds_system;
