-- 0009 — notebooks: per-org markdown notes (maintenance / incident analysis).
-- `shared` = visible to every member; otherwise only to its author.

CREATE TABLE notebooks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  author_id  uuid NOT NULL,
  title      text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  body       text NOT NULL DEFAULT '' CHECK (length(body) <= 100000),
  shared     boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notebooks_org ON notebooks (org_id, updated_at DESC);

ALTER TABLE notebooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE notebooks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notebooks
  USING (org_id = wds_ctx_org()) WITH CHECK (org_id = wds_ctx_org());

GRANT SELECT, INSERT, UPDATE, DELETE ON notebooks TO wds_app;
