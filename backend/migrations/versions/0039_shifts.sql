-- 0039 - production shifts per site (roadmap 5.1). A shift is a named
-- daily window (start_time may be > end_time for overnight shifts) active on
-- a set of ISO weekdays. `breaks` is a jsonb array of
-- {"start":"HH:MM","end":"HH:MM","name":"…"} windows subtracted from planned
-- production time by the OEE math. Applied by 0039_shifts.py as wds_owner in
-- one transaction.

CREATE TABLE shifts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  site_id      uuid NOT NULL,
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  start_time   time NOT NULL,
  end_time     time NOT NULL,
  -- ISO weekday numbers, 1=Mon..7=Sun; empty = never
  days_of_week smallint[] NOT NULL DEFAULT '{}'
               CHECK (days_of_week <@ '{1,2,3,4,5,6,7}'::smallint[]),
  breaks       jsonb NOT NULL DEFAULT '[]'
               CHECK (jsonb_typeof(breaks) = 'array'),
  enabled      boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, site_id, name),
  CHECK (start_time <> end_time),
  CHECK (jsonb_array_length(breaks) <= 16),
  FOREIGN KEY (org_id, site_id) REFERENCES sites (org_id, id) ON DELETE CASCADE
);
CREATE INDEX shifts_site ON shifts (org_id, site_id) WHERE enabled;

ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON shifts
  USING (org_id = wds_ctx_org()) WITH CHECK (org_id = wds_ctx_org());

-- OEE / report readers run as wds_system inside tenant_tx (tenant_isolation
-- covers the rows); the grant is the only thing missing.
GRANT SELECT, INSERT, UPDATE, DELETE ON shifts TO wds_app;
GRANT SELECT ON shifts TO wds_system;
