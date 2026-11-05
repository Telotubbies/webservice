-- 0043 - scheduled reports (roadmap 5.4). One row = one report template
-- emailed on a schedule in the ORG's timezone: `send_time` is the local
-- clock time, `send_day` picks the weekday (1=Mon..7=Sun) for weekly_oee or
-- the day of month (1-28) for monthly_alarms; NULL = every day (daily, or
-- after each shift for the shift template). The sweeper (wds_system inside
-- tenant_tx) claims due rows by writing last_run_at and enqueues a
-- send_email job; tenants only read/CRUD through wds_app.

CREATE TABLE report_schedules (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  site_id    uuid,
  template   text NOT NULL
             CHECK (template IN ('shift', 'daily', 'weekly_oee', 'monthly_alarms')),
  to_addrs   jsonb NOT NULL DEFAULT '[]'
             CHECK (jsonb_typeof(to_addrs) = 'array' AND jsonb_array_length(to_addrs) BETWEEN 1 AND 20),
  send_time  time NOT NULL DEFAULT '07:00',
  send_day   smallint CHECK (send_day BETWEEN 1 AND 31),
  enabled    boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, site_id) REFERENCES sites (org_id, id) ON DELETE CASCADE,
  CHECK (template <> 'weekly_oee' OR send_day BETWEEN 1 AND 7),
  CHECK (template <> 'monthly_alarms' OR send_day BETWEEN 1 AND 28)
);

ALTER TABLE report_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_schedules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON report_schedules
  USING (org_id = wds_ctx_org()) WITH CHECK (org_id = wds_ctx_org());

GRANT SELECT, INSERT, UPDATE, DELETE ON report_schedules TO wds_app;
GRANT SELECT, UPDATE ON report_schedules TO wds_system;
