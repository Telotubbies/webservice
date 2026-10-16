-- 0013 - SLO definitions and corrections. An SLO is an availability target on
-- one tag (share of good-quality samples). A correction is a window whose
-- samples are excluded from the SLI (planned maintenance, known bad data).

CREATE TABLE slos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  tag_id      uuid NOT NULL,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  target      double precision NOT NULL CHECK (target > 0 AND target < 100),
  warning     double precision NOT NULL CHECK (warning >= target AND warning <= 100),
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, name),
  FOREIGN KEY (org_id, tag_id) REFERENCES tags (org_id, id) ON DELETE CASCADE
);

CREATE TABLE slo_corrections (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  slo_id     uuid NOT NULL,
  starts_at  timestamptz NOT NULL,
  ends_at    timestamptz NOT NULL,
  reason     text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (ends_at - starts_at <= interval '30 days'),
  FOREIGN KEY (org_id, slo_id) REFERENCES slos (org_id, id) ON DELETE CASCADE
);
CREATE INDEX slo_corrections_slo ON slo_corrections (slo_id, starts_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['slos', 'slo_corrections'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = wds_ctx_org()) '
                   'WITH CHECK (org_id = wds_ctx_org())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO wds_app', t);
  END LOOP;
END $$;
