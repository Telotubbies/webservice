-- 0008 — downtimes: maintenance windows that mute alarm raising. rule_id NULL
-- = every rule in the org. `recurring` repeats the window weekly (so it must
-- fit inside 7 days). The alarm engine (wds_system, org context set) reads it.

CREATE TABLE downtimes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  rule_id     uuid,
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  recurring   boolean NOT NULL DEFAULT false,
  created_by  uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (NOT recurring OR ends_at - starts_at <= interval '7 days'),
  FOREIGN KEY (org_id, rule_id) REFERENCES alarm_rules (org_id, id) ON DELETE CASCADE
);
CREATE INDEX downtimes_org ON downtimes (org_id, ends_at DESC);

ALTER TABLE downtimes ENABLE ROW LEVEL SECURITY;
ALTER TABLE downtimes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON downtimes
  USING (org_id = wds_ctx_org()) WITH CHECK (org_id = wds_ctx_org());

GRANT SELECT, INSERT, UPDATE, DELETE ON downtimes TO wds_app;
GRANT SELECT ON downtimes TO wds_system;
