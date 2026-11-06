-- 0057 - alarm shelving accountability (F06, ISA-18.2).
-- A shelf records who shelved the alarm, when and why, so the shelved list
-- can show it; the reason is mandatory in the API.
-- Applied by 0057_alarm_shelf.py as wds_owner in one transaction.

ALTER TABLE alarms ADD COLUMN shelved_at timestamptz;
ALTER TABLE alarms ADD COLUMN shelved_by uuid REFERENCES users(id);
ALTER TABLE alarms ADD COLUMN shelve_reason text;
