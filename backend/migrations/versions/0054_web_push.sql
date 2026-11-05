-- 0054 - mobile / Web Push (spec 2026-10-19 §8).
--   * push_subscriptions: one row per browser/device a member enabled push on
--   * notification_channels.type gains 'webpush'
--   * organizations.mobile_control: show command buttons on narrow screens
--     (default off; a UX guard, the security boundary stays role + area + step-up)
-- Applied by 0054_web_push.py as wds_owner in one transaction.

ALTER TABLE notification_channels DROP CONSTRAINT notification_channels_type_check;
ALTER TABLE notification_channels ADD CONSTRAINT notification_channels_type_check
  CHECK (type IN ('email', 'line', 'webhook', 'teams', 'slack', 'webpush'));

ALTER TABLE organizations ADD COLUMN mobile_control boolean NOT NULL DEFAULT false;

CREATE TABLE push_subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  endpoint   text NOT NULL CHECK (length(endpoint) BETWEEN 20 AND 1000),
  p256dh     text NOT NULL CHECK (length(p256dh) BETWEEN 80 AND 100),
  auth       text NOT NULL CHECK (length(auth) BETWEEN 20 AND 30),
  ua         text CHECK (length(ua) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_ok_at timestamptz,
  UNIQUE (org_id, endpoint)
);
CREATE INDEX push_subscriptions_user ON push_subscriptions (org_id, user_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON push_subscriptions
  USING (org_id = wds_ctx_org()) WITH CHECK (org_id = wds_ctx_org());
-- the notify worker sends as wds_app inside a tenant tx and prunes dead endpoints
GRANT SELECT, INSERT, UPDATE, DELETE ON push_subscriptions TO wds_app;
