-- 0036 - outbound webhooks (roadmap §9 5.5 "integrations out"): per-org
-- endpoints that receive signed JSON events (alarm_raised, alarm_cleared,
-- downtime_classified, incident_opened). No event code touches alarms.py:
-- a sweeper tails the source tables with (ts, id) cursors in webhook_cursor
-- and enqueues webhook_deliver jobs; the delivery worker POSTs with an
-- X-WDS-Signature HMAC-SHA256 header and logs each attempt to
-- webhook_deliveries. The HMAC secret is sealed (datasources/secretbox) and
-- write-only — no SELECT grant exposes secret_enc to wds_app.
-- Applied by 0036_webhooks.py as wds_owner in one transaction.

CREATE TABLE webhook_endpoints (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  url        text NOT NULL CHECK (length(url) BETWEEN 8 AND 1000
                                AND url ~ '^https://'),   -- TLS only; app validates too
  secret_enc bytea NOT NULL,                     -- sealed; never selectable by wds_app
  events     text[] NOT NULL
             CHECK (cardinality(events) BETWEEN 1 AND 4
                    AND events <@ ARRAY['alarm_raised', 'alarm_cleared',
                                        'downtime_classified',
                                        'incident_opened']::text[]),
  enabled    boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhook_endpoints_org ON webhook_endpoints (org_id)
  WHERE enabled;

ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_endpoints FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON webhook_endpoints
  USING (org_id = wds_ctx_org()) WITH CHECK (org_id = wds_ctx_org());
-- the sweep lists every enabled endpoint across orgs before fanning out
-- into per-org tenant_tx reads
CREATE POLICY system_all ON webhook_endpoints FOR ALL TO wds_system
  USING (true) WITH CHECK (true);
GRANT INSERT, UPDATE, DELETE ON webhook_endpoints TO wds_app;
GRANT SELECT (id, org_id, url, events, enabled, created_by, created_at,
              updated_at) ON webhook_endpoints TO wds_app;
-- sweeper + delivery worker run as wds_system inside tenant_tx
GRANT SELECT ON webhook_endpoints TO wds_system;


CREATE TABLE webhook_deliveries (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  endpoint_id uuid NOT NULL,
  event      text NOT NULL,
  job_id     bigint,
  status     text NOT NULL DEFAULT 'queued'
             CHECK (status IN ('queued', 'delivered', 'failed')),
  attempts   integer NOT NULL DEFAULT 0,
  last_code  integer,
  last_error text CHECK (last_error IS NULL OR length(last_error) <= 2000),
  at         timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhook_deliveries_org ON webhook_deliveries (org_id, at DESC);

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON webhook_deliveries
  USING (org_id = wds_ctx_org()) WITH CHECK (org_id = wds_ctx_org());
GRANT SELECT ON webhook_deliveries TO wds_app;
GRANT SELECT, INSERT, UPDATE ON webhook_deliveries TO wds_system;


-- Sweep cursors: one row per (org, event source) — a source-only key would
-- make every org share one cursor and starve each other. System-internal;
-- no tenant visibility at all (fail closed for wds_app).
CREATE TABLE webhook_cursor (
  org_id  uuid NOT NULL DEFAULT wds_ctx_org()
          REFERENCES organizations (id) ON DELETE CASCADE,
  source  text NOT NULL,
  last_ts timestamptz NOT NULL DEFAULT '-infinity',
  last_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  PRIMARY KEY (org_id, source)
);
ALTER TABLE webhook_cursor ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_cursor FORCE ROW LEVEL SECURITY;
-- context-scoped rather than USING(true): inside a per-org tenant_tx the
-- sweeper's `WHERE source=$1` read must hit THIS org's row; pre-context
-- (global sweep enumeration) still sees every row.
CREATE POLICY system_all ON webhook_cursor FOR ALL TO wds_system
  USING (wds_ctx_org() IS NULL OR org_id = wds_ctx_org())
  WITH CHECK (wds_ctx_org() IS NULL OR org_id = wds_ctx_org());
GRANT SELECT, INSERT, UPDATE ON webhook_cursor TO wds_system;
