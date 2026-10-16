-- 0028 — on-call (§3.3). A rotation is one row per team: an ordered member
-- list and an anchor instant; the active member is
-- user_ids[floor((now-anchor)/7d) mod n]. Overrides pin one member for an
-- interval and win over the rotation while active.

CREATE TABLE oncall_rotations (
  org_id        uuid NOT NULL,
  team_id       uuid NOT NULL,
  user_ids      uuid[] NOT NULL,
  anchor        timestamptz NOT NULL,
  handoff_s     integer NOT NULL DEFAULT 604800
                CHECK (handoff_s BETWEEN 3600 AND 2592000),  -- weekly default
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id),
  UNIQUE (org_id, team_id),
  FOREIGN KEY (org_id, team_id) REFERENCES teams (org_id, id) ON DELETE CASCADE
);

CREATE TABLE oncall_overrides (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL,
  team_id    uuid NOT NULL,
  user_id    uuid NOT NULL,
  starts_at  timestamptz NOT NULL,
  ends_at    timestamptz NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, team_id) REFERENCES teams (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, user_id) REFERENCES memberships (org_id, user_id) ON DELETE CASCADE
);
CREATE INDEX oncall_overrides_team ON oncall_overrides (team_id, ends_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['oncall_rotations', 'oncall_overrides'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = wds_ctx_org()) '
                   'WITH CHECK (org_id = wds_ctx_org())', t);
    EXECUTE format('CREATE POLICY system_all ON %I FOR ALL TO wds_system USING (true) WITH CHECK (true)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO wds_app', t);
    EXECUTE format('GRANT SELECT ON %I TO wds_system', t);
  END LOOP;
END $$;
