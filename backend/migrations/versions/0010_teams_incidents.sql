-- 0010 — teams + incidents. A team groups org members; an incident tracks a
-- problem from declaration to resolution, optionally tied to the alarm that
-- raised it. incident_events is the append-only timeline (no UPDATE/DELETE
-- grant). SET NULL columns are listed explicitly so org_id stays set.

CREATE TABLE teams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id)
);
CREATE UNIQUE INDEX teams_name ON teams (org_id, lower(name));

CREATE TABLE team_members (
  org_id  uuid NOT NULL,
  team_id uuid NOT NULL,
  user_id uuid NOT NULL,
  PRIMARY KEY (team_id, user_id),
  FOREIGN KEY (org_id, team_id) REFERENCES teams (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, user_id) REFERENCES memberships (org_id, user_id) ON DELETE CASCADE
);

CREATE TABLE incidents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  title         text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  severity      text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'acknowledged', 'resolved')),
  created_by    uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  acked_at      timestamptz,
  resolved_at   timestamptz,
  alarm_id      uuid,
  owner_team_id uuid,
  UNIQUE (org_id, id),
  CHECK ((status = 'resolved') = (resolved_at IS NOT NULL)),
  CHECK (status = 'active' OR acked_at IS NOT NULL),
  FOREIGN KEY (org_id, alarm_id) REFERENCES alarms (org_id, id) ON DELETE SET NULL (alarm_id),
  FOREIGN KEY (org_id, owner_team_id) REFERENCES teams (org_id, id) ON DELETE SET NULL (owner_team_id)
);
CREATE INDEX incidents_org ON incidents (org_id, created_at DESC);

CREATE TABLE incident_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  incident_id uuid NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('created', 'status', 'note')),
  author_id   uuid NOT NULL,
  body        text NOT NULL DEFAULT '' CHECK (length(body) <= 2000),
  at          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, incident_id) REFERENCES incidents (org_id, id) ON DELETE CASCADE
);
CREATE INDEX incident_events_inc ON incident_events (incident_id, at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['teams', 'team_members', 'incidents', 'incident_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = wds_ctx_org()) WITH CHECK (org_id = wds_ctx_org())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON teams, team_members, incidents TO wds_app;
GRANT SELECT, INSERT ON incident_events TO wds_app;
