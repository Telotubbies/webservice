-- 0027 — alarm notification routing (§3.2). A rule may name channels
-- directly, teams (all channels bound to the team), or a team whose current
-- on-call member is emailed. `notify_min_severity` filters the alarm's own
-- severity; `notify_on_clear` sends one message when the episode resolves.
-- alarm_notify_state is the de-dup table: one row per (episode, channel,
-- kind) means one message per alarm episode per channel. Built-in vision
-- alarms use episode keys 'vision:<camera>:<condition>' and rows are deleted
-- on recovery so a re-raise notifies again.

ALTER TABLE alarm_rules
  ADD COLUMN notify_channel_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN notify_team_ids    uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN notify_oncall_team uuid,
  ADD COLUMN notify_min_severity text NOT NULL DEFAULT 'info'
    CHECK (notify_min_severity IN ('info', 'warning', 'critical')),
  ADD COLUMN notify_on_clear    boolean NOT NULL DEFAULT false;

CREATE TABLE alarm_notify_state (
  org_id     uuid NOT NULL,
  episode    text NOT NULL CHECK (length(episode) BETWEEN 1 AND 200),
  channel_id uuid NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('raised', 'cleared', 'vision')),
  sent_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, episode, channel_id, kind)
);

ALTER TABLE alarm_notify_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE alarm_notify_state FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON alarm_notify_state
  USING (org_id = wds_ctx_org()) WITH CHECK (org_id = wds_ctx_org());
CREATE POLICY system_all ON alarm_notify_state
  FOR ALL TO wds_system USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON alarm_notify_state TO wds_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON alarm_notify_state TO wds_system;
