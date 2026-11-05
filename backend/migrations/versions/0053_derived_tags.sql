-- 0053 - derived (calculated) tags (spec 2026-10-19 §7). A derived tag is an
-- ordinary tag row with source='derived': no edge, never writable, so alarms,
-- trends, dashboards and history treat it like any device tag. Its formula and
-- variable bindings live in tag_formulas.
-- Applied by 0053_derived_tags.py as wds_owner in one transaction.

ALTER TABLE tags ADD COLUMN source text NOT NULL DEFAULT 'device'
  CHECK (source IN ('device', 'derived'));
ALTER TABLE tags ADD CONSTRAINT tags_derived_shape
  CHECK (source = 'device' OR (edge_id IS NULL AND source_id IS NULL AND NOT writable));

CREATE TABLE tag_formulas (
  org_id     uuid NOT NULL,
  tag_id     uuid PRIMARY KEY,
  expr       text NOT NULL CHECK (length(expr) BETWEEN 1 AND 500),
  inputs     jsonb NOT NULL CHECK (jsonb_typeof(inputs) = 'object'),  -- {"a": "<tag uuid>", ...}
  version    integer NOT NULL DEFAULT 1,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, tag_id),
  FOREIGN KEY (org_id, tag_id) REFERENCES tags (org_id, id) ON DELETE CASCADE
);

ALTER TABLE tag_formulas ENABLE ROW LEVEL SECURITY;
ALTER TABLE tag_formulas FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tag_formulas
  USING (org_id = wds_ctx_org()) WITH CHECK (org_id = wds_ctx_org());
GRANT SELECT, INSERT, UPDATE, DELETE ON tag_formulas TO wds_app;
-- the engine loads formulas as wds_system, one tenant at a time
GRANT SELECT ON tag_formulas TO wds_system;
