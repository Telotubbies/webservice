-- 0030 — alarm lifecycle completeness (§3.5). shelved_until silences
-- notifications and escalation until that instant (the shelve sweep clears
-- expired shelves, re-opening the alarm); assigned_to records ownership.
-- alarm_events is the append-only per-alarm timeline (comment / assign /
-- shelve / unshelve / ack) — every lifecycle action also writes audit_log.

ALTER TABLE alarms
  ADD COLUMN shelved_until timestamptz,
  ADD COLUMN assigned_to   uuid REFERENCES users (id);

CREATE INDEX alarms_shelved ON alarms (shelved_until) WHERE shelved_until IS NOT NULL;

CREATE TABLE alarm_events (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id   uuid NOT NULL,
  alarm_id uuid NOT NULL,
  kind     text NOT NULL CHECK (kind IN ('comment', 'assign', 'shelve', 'unshelve', 'ack')),
  author   text NOT NULL CHECK (length(author) BETWEEN 1 AND 200),  -- user:<id> | system
  body     text NOT NULL DEFAULT '' CHECK (length(body) <= 2000),
  at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, alarm_id) REFERENCES alarms (org_id, id) ON DELETE CASCADE
);
CREATE INDEX alarm_events_alarm ON alarm_events (alarm_id, at, id);

ALTER TABLE alarm_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE alarm_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON alarm_events
  USING (org_id = wds_ctx_org()) WITH CHECK (org_id = wds_ctx_org());
CREATE POLICY system_all ON alarm_events
  FOR ALL TO wds_system USING (true) WITH CHECK (true);

GRANT SELECT, INSERT ON alarm_events TO wds_app;          -- append-only
GRANT SELECT, INSERT ON alarm_events TO wds_system;
GRANT USAGE, SELECT ON SEQUENCE alarm_events_id_seq TO wds_app;
GRANT USAGE, SELECT ON SEQUENCE alarm_events_id_seq TO wds_system;
