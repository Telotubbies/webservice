-- 0058 - plant board (F07): the 2D SCADA board built from side captures of
-- each 3D part. A board is a layout (positions, locks, link edits) per model;
-- one draft is edited, publish freezes it as the next version, rollback
-- re-publishes an older version. Captures are keyed by the model's sha256 and
-- the part's first glTF node, so a changed model is detected, not silently
-- drawn with stale pictures.
-- Applied by 0058_plant_boards.py as wds_owner in one transaction.

CREATE TABLE plant_boards (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  site_id     uuid NOT NULL,
  model_id    uuid,                       -- NULL = the bundled demo plant
  model_sha   text NOT NULL CHECK (length(model_sha) BETWEEN 4 AND 64),
  version     integer CHECK (version >= 1),
  status      text NOT NULL CHECK (status IN ('draft', 'published')),
  layout      jsonb NOT NULL,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'draft') = (version IS NULL)),
  CHECK (jsonb_typeof(layout) = 'object' AND octet_length(layout::text) <= 262144),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, site_id) REFERENCES sites (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, model_id) REFERENCES plant_models (org_id, id) ON DELETE CASCADE
);
-- one draft and unique version numbers per (site, model)
CREATE UNIQUE INDEX plant_boards_one_draft ON plant_boards (org_id, site_id, model_sha) WHERE status = 'draft';
CREATE UNIQUE INDEX plant_boards_version ON plant_boards (org_id, site_id, model_sha, version) WHERE status = 'published';

CREATE TABLE plant_board_captures (
  org_id     uuid NOT NULL,
  site_id    uuid NOT NULL,
  model_sha  text NOT NULL CHECK (length(model_sha) BETWEEN 4 AND 64),
  part_key   text NOT NULL CHECK (length(part_key) BETWEEN 1 AND 40),
  w          integer NOT NULL CHECK (w BETWEEN 1 AND 2048),
  h          integer NOT NULL CHECK (h BETWEEN 1 AND 2048),
  view       text NOT NULL CHECK (view IN ('side', 'front')),
  png        bytea NOT NULL CHECK (octet_length(png) BETWEEN 8 AND 524288),
  box        jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, site_id, model_sha, part_key),
  FOREIGN KEY (org_id, site_id) REFERENCES sites (org_id, id) ON DELETE CASCADE
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['plant_boards', 'plant_board_captures'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = wds_ctx_org()) '
                   'WITH CHECK (org_id = wds_ctx_org())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO wds_app', t);
  END LOOP;
END $$;
