-- 0055 - alarm lifecycle (F02, ISA-18.2 style).
--   * state gains 'rtn_unack': the process returned to normal but nobody has
--     acknowledged yet; the alarm stays open (and visible) until acked
--   * alarms.late: raised from a back-filled sample (event time older than
--     ALARM_FRESH_S when it reached the engine); raised_at is the event time
--   * deleting a rule no longer cascades its alarm history away: rule_id is
--     set NULL and rule_name keeps the label the console shows
-- Applied by 0055_alarm_rtn_late.py as wds_owner in one transaction.

ALTER TABLE alarms DROP CONSTRAINT alarms_state_check;
ALTER TABLE alarms ADD CONSTRAINT alarms_state_check
  CHECK (state IN ('active', 'acked', 'rtn_unack', 'cleared'));

-- rtn_unack is still open: one open alarm per rule covers it too
DROP INDEX alarms_one_open_per_rule;
CREATE UNIQUE INDEX alarms_one_open_per_rule ON alarms (org_id, rule_id)
  WHERE state IN ('active', 'acked', 'rtn_unack');

ALTER TABLE alarms ADD COLUMN late boolean NOT NULL DEFAULT false;

ALTER TABLE alarms ADD COLUMN rule_name text;
UPDATE alarms a SET rule_name = r.name FROM alarm_rules r WHERE r.id = a.rule_id;

ALTER TABLE alarms ALTER COLUMN rule_id DROP NOT NULL;
ALTER TABLE alarms DROP CONSTRAINT alarms_org_id_tag_id_rule_id_fkey;
ALTER TABLE alarms ADD CONSTRAINT alarms_org_id_tag_id_rule_id_fkey
  FOREIGN KEY (org_id, tag_id, rule_id) REFERENCES alarm_rules (org_id, tag_id, id)
  ON DELETE SET NULL (rule_id);
