-- 0067 - closed shift/hour totals (F18) + webhook endpoints may subscribe to them.
-- A closed row is immutable: a changed total is a NEW version, never an update.

CREATE TABLE shift_summary (
  org_id      uuid NOT NULL,
  site_id     uuid NOT NULL,
  device_id   uuid NOT NULL,
  shift_name  text NOT NULL,
  shift_date  date NOT NULL,                          -- site-local date
  from_ts     timestamptz NOT NULL,
  to_ts       timestamptz NOT NULL,
  version     integer NOT NULL DEFAULT 1,
  qty_total   numeric, qty_good numeric, qty_scrap numeric,
  run_s       integer, stop_s integer,
  coverage_pct real,
  work_order_id uuid,
  data_origin text NOT NULL DEFAULT 'production',
  closed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, device_id, shift_name, shift_date, version)
);
CREATE TABLE hour_summary (
  org_id      uuid NOT NULL,
  site_id     uuid NOT NULL,
  device_id   uuid NOT NULL,
  hour_start  timestamptz NOT NULL,
  version     integer NOT NULL DEFAULT 1,
  qty_total   numeric, qty_good numeric, qty_scrap numeric,
  run_s       integer, stop_s integer,
  coverage_pct real,
  data_origin text NOT NULL DEFAULT 'production',
  closed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, device_id, hour_start, version)
);
DO $$
DECLARE t text; c text;
BEGIN
  FOREACH t IN ARRAY ARRAY['shift_summary', 'hour_summary'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = wds_ctx_org()) '
                   'WITH CHECK (org_id = wds_ctx_org())', t);
    EXECUTE format('GRANT SELECT ON %I TO wds_app', t);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO wds_system', t);   -- no UPDATE: closed rows are immutable
    EXECUTE format('CREATE POLICY system_all ON %I FOR ALL TO wds_system USING (wds_ctx_org() IS NULL OR org_id = wds_ctx_org()) '
                   'WITH CHECK (wds_ctx_org() IS NULL OR org_id = wds_ctx_org())', t);
  END LOOP;
  -- widen the webhook event list (drop whichever CHECKs mention events)
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'webhook_endpoints'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) LIKE '%events%' LOOP
    EXECUTE format('ALTER TABLE webhook_endpoints DROP CONSTRAINT %I', c);
  END LOOP;
  ALTER TABLE webhook_endpoints ADD CONSTRAINT webhook_endpoints_events_v2 CHECK (
    cardinality(events) BETWEEN 1 AND 8 AND events <@ ARRAY['alarm_raised', 'alarm_cleared',
      'downtime_classified', 'incident_opened', 'shift_summary.closed', 'hour_summary.closed',
      'work_order.progress']::text[]);
END $$;
