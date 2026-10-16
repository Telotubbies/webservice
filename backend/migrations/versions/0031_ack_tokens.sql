-- 0031 — ack links (§3.4). The URL token is HMAC over (alarm_id, jti, expiry)
-- keyed by DATA_SOURCE_KEY — the same pattern as stream_sig/media_sig — and
-- this table is what makes it single-use: jti exists once, used_at set once.
-- The raw token is never stored.

CREATE TABLE ack_tokens (
  jti        uuid PRIMARY KEY,
  org_id     uuid NOT NULL,
  alarm_id   uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  used_by    uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, jti),
  FOREIGN KEY (org_id, alarm_id) REFERENCES alarms (org_id, id) ON DELETE CASCADE
);
CREATE INDEX ack_tokens_alarm ON ack_tokens (alarm_id, created_at DESC);

ALTER TABLE ack_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE ack_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ack_tokens
  USING (org_id = wds_ctx_org()) WITH CHECK (org_id = wds_ctx_org());
CREATE POLICY system_all ON ack_tokens
  FOR ALL TO wds_system USING (true) WITH CHECK (true);

-- the only app-side write past insert is the single-use consume:
-- UPDATE ... SET used_at, used_by (notify.py) — narrow the grant to it.
GRANT SELECT, INSERT, UPDATE (used_at, used_by) ON ack_tokens TO wds_app;
GRANT SELECT, INSERT, UPDATE ON ack_tokens TO wds_system;
