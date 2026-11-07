-- 0064 - saved datasets (F13): a named, time-bucketed selection of tags that
-- can be exported as CSV. Definition only; the data stays in tag_history.
CREATE TABLE datasets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL,
  site_id    uuid NOT NULL,
  name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  tag_ids    uuid[] NOT NULL CHECK (cardinality(tag_ids) BETWEEN 1 AND 50),
  from_ts    timestamptz NOT NULL,
  to_ts      timestamptz NOT NULL,
  bucket_s   integer NOT NULL CHECK (bucket_s BETWEEN 1 AND 86400),
  train_pct  integer NOT NULL DEFAULT 70 CHECK (train_pct BETWEEN 1 AND 98),   -- chronological split: oldest train_pct %
  val_pct    integer NOT NULL DEFAULT 15 CHECK (val_pct BETWEEN 0 AND 98),    -- then val_pct %; the rest is test
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_ts < to_ts),
  CHECK (train_pct + val_pct < 100),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, site_id) REFERENCES sites (org_id, id) ON DELETE CASCADE
);
ALTER TABLE datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE datasets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON datasets USING (org_id = wds_ctx_org()) WITH CHECK (org_id = wds_ctx_org());
GRANT SELECT, INSERT, UPDATE, DELETE ON datasets TO wds_app;
