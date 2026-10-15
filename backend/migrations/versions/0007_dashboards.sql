-- 0007 — dashboards: per-org saved boards (SDLC FR-26). `body` is the widget
-- list + range as the web editor wrote it; the server only bounds its size.
-- `shared` = visible to every member; otherwise only to its author.

CREATE TABLE dashboards (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  author_id   uuid NOT NULL,
  title       text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '',
  shared      boolean NOT NULL DEFAULT true,
  body        jsonb NOT NULL DEFAULT '{}',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id)
);
CREATE INDEX dashboards_org ON dashboards (org_id, updated_at DESC);

ALTER TABLE dashboards ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboards FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dashboards
  USING (org_id = wds_ctx_org()) WITH CHECK (org_id = wds_ctx_org());

GRANT SELECT, INSERT, UPDATE, DELETE ON dashboards TO wds_app;
