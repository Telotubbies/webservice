-- 0029 — escalation policies (§3.3). levels is a JSON array:
-- [{"after_minutes": N, "channel_ids": [], "team_ids": [], "oncall_team": uuid|null}]
-- Level 1's after_minutes counts from alarms.raised_at; each later level's
-- counts from esc_level_at (when the previous level fired). rule_id NULL = the
-- org-wide default policy; a rule-specific row wins. alarms.esc_level counts
-- how many levels have fired (ack or shelve stops the sweep).

CREATE TABLE escalation_policies (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL,
  rule_id    uuid,
  name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  levels     jsonb NOT NULL CHECK (jsonb_typeof(levels) = 'array'
             AND jsonb_array_length(levels) BETWEEN 1 AND 10),
  enabled    boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, rule_id),
  FOREIGN KEY (org_id, rule_id) REFERENCES alarm_rules (org_id, id) ON DELETE CASCADE
);
-- UNIQUE (org_id, rule_id) admits multiple NULL rule_id rows; the org-wide
-- default policy needs its own partial unique index.
CREATE UNIQUE INDEX escalation_policies_one_default
  ON escalation_policies (org_id) WHERE rule_id IS NULL;

ALTER TABLE alarms
  ADD COLUMN esc_level   integer NOT NULL DEFAULT 0,
  ADD COLUMN esc_level_at timestamptz;

ALTER TABLE escalation_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalation_policies FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON escalation_policies
  USING (org_id = wds_ctx_org()) WITH CHECK (org_id = wds_ctx_org());
CREATE POLICY system_all ON escalation_policies
  FOR ALL TO wds_system USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON escalation_policies TO wds_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON escalation_policies TO wds_system;
