-- 0042 - downtime reason tree + machine-stop downtime records (roadmap 5.2).
--
-- `downtime_reasons` is a per-org tree (parent_id): the operator picks a leaf
-- like Mechanical → Jam on the phone when classifying a stop.
--
-- The existing `downtimes` table (0008) is extended rather than duplicated:
-- kind='window' keeps the maintenance-window semantics (rule_id, recurring,
-- planned ends_at); kind='stop' is an auto-recorded machine stop —
-- device_id/site_id identify the machine, `state` is the machine state that
-- caused it, ends_at NULL while the stop is still open, needs_reason until an
-- operator classifies it with reason_id + note. created_by becomes nullable:
-- stop rows are written by the backend (wds_system), not a user.

CREATE TABLE downtime_reasons (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  parent_id  uuid,
  code       text NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
  name_th    text NOT NULL CHECK (length(name_th) BETWEEN 1 AND 120),
  name_en    text NOT NULL CHECK (length(name_en) BETWEEN 1 AND 120),
  enabled    boolean NOT NULL DEFAULT true,
  sort       integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, code),
  FOREIGN KEY (org_id, parent_id) REFERENCES downtime_reasons (org_id, id)
    ON DELETE SET NULL (parent_id)
);

ALTER TABLE downtimes
  ALTER COLUMN ends_at DROP NOT NULL,
  ALTER COLUMN created_by DROP NOT NULL,
  ADD COLUMN kind         text NOT NULL DEFAULT 'window'
                          CHECK (kind IN ('window', 'stop')),
  ADD COLUMN site_id      uuid,
  ADD COLUMN device_id    uuid,
  ADD COLUMN state        text CHECK (state IS NULL OR state IN ('idle', 'stopped', 'fault')),
  ADD COLUMN needs_reason boolean NOT NULL DEFAULT false,
  ADD COLUMN reason_id    uuid,
  ADD COLUMN note         text CHECK (note IS NULL OR length(note) <= 500),
  ADD COLUMN classified_by uuid,
  ADD COLUMN classified_at timestamptz,
  ADD FOREIGN KEY (org_id, site_id) REFERENCES sites (org_id, id) ON DELETE CASCADE,
  ADD FOREIGN KEY (org_id, device_id) REFERENCES devices (org_id, id) ON DELETE CASCADE,
  ADD FOREIGN KEY (org_id, reason_id) REFERENCES downtime_reasons (org_id, id) ON DELETE SET NULL (reason_id);
-- one OPEN stop per machine: a UNIQUE partial index so replica retries /
-- duplicate detections cannot create a second open stop for the same device.
CREATE UNIQUE INDEX downtimes_open_stops ON downtimes (org_id, device_id)
  WHERE kind = 'stop' AND ends_at IS NULL;
CREATE INDEX downtimes_reason ON downtimes (org_id, reason_id, starts_at DESC)
  WHERE kind = 'stop';

ALTER TABLE downtime_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE downtime_reasons FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON downtime_reasons
  USING (org_id = wds_ctx_org()) WITH CHECK (org_id = wds_ctx_org());

GRANT SELECT, INSERT, UPDATE, DELETE ON downtime_reasons TO wds_app;
GRANT SELECT ON downtime_reasons TO wds_system;
-- the stop detector writes/closes downtime rows as wds_system inside tenant_tx
GRANT INSERT, UPDATE ON downtimes TO wds_system;
