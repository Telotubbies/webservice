-- 0026 — notification channels (roadmap §3.1) + delivery log.
-- Channel secrets (SMTP passwords, LINE tokens, webhook URLs/secrets) live in
-- secrets_enc (AES-GCM, same box as data-source secrets); `config` holds only
-- non-secret material and neither column is ever returned raw by the API.
-- `team_id` binds a channel to a team ("rule routed to team X notifies only
-- team X's channel", §3.2 acceptance).

CREATE TABLE notification_channels (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  team_id     uuid,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  type        text NOT NULL CHECK (type IN ('email', 'line', 'webhook', 'teams', 'slack')),
  config      jsonb NOT NULL DEFAULT '{}',
  secrets_enc bytea,
  enabled     boolean NOT NULL DEFAULT true,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, team_id) REFERENCES teams (org_id, id) ON DELETE SET NULL (team_id)
);
CREATE UNIQUE INDEX notification_channels_name ON notification_channels (org_id, lower(name));

-- One row per attempted delivery (test, alarm raise/clear, escalation level,
-- contract send_email job). `target` is a redacted descriptor (host or masked
-- address) — never a token-bearing URL.
CREATE TABLE notification_deliveries (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id     uuid NOT NULL,
  channel_id uuid,
  alarm_id   uuid,
  kind       text NOT NULL DEFAULT 'notify'
             CHECK (kind IN ('test', 'raised', 'cleared', 'escalation', 'email', 'vision')),
  target     text NOT NULL DEFAULT '' CHECK (length(target) <= 300),
  status     text NOT NULL CHECK (status IN ('sent', 'failed', 'retrying', 'suppressed')),
  attempts   integer NOT NULL DEFAULT 0,
  last_error text CHECK (last_error IS NULL OR length(last_error) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, channel_id) REFERENCES notification_channels (org_id, id)
    ON DELETE SET NULL (channel_id),
  FOREIGN KEY (org_id, alarm_id) REFERENCES alarms (org_id, id)
    ON DELETE SET NULL (alarm_id)
);
CREATE INDEX notification_deliveries_org ON notification_deliveries (org_id, created_at DESC);
CREATE INDEX notification_deliveries_alarm ON notification_deliveries (alarm_id)
  WHERE alarm_id IS NOT NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['notification_channels', 'notification_deliveries'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = wds_ctx_org()) '
                   'WITH CHECK (org_id = wds_ctx_org())', t);
    -- the notify worker claims jobs as wds_system and then opens tenant_tx
    EXECUTE format('CREATE POLICY system_all ON %I FOR ALL TO wds_system USING (true) WITH CHECK (true)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO wds_system', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON notification_deliveries TO wds_app;
-- secrets_enc is write-only for wds_app: the sealed credentials are opened
-- only in wds_system context (the notify send path); the API never returns
-- them, so no app-role SELECT reaches the ciphertext.
GRANT INSERT, UPDATE, DELETE ON notification_channels TO wds_app;
GRANT SELECT (id, org_id, team_id, name, type, config, enabled, created_by,
              created_at, updated_at) ON notification_channels TO wds_app;

GRANT USAGE, SELECT ON SEQUENCE notification_deliveries_id_seq TO wds_app;
GRANT USAGE, SELECT ON SEQUENCE notification_deliveries_id_seq TO wds_system;
