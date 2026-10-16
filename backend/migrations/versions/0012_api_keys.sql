-- 0012 - API keys for service accounts. A key authenticates as a service user
-- (users.sub = 'svc:<uuid>') that holds a normal membership in one org, so
-- every existing role check applies unchanged. Only sha256(key) is stored.
-- The auth path knows the hash but not the org yet: key_by_hash lets it read
-- exactly the one matching row (same shape as invites.invite_by_token).

CREATE FUNCTION wds_ctx_apikey() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('app.key_hash', true), '') $$;

CREATE TABLE api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  prefix       text NOT NULL,
  key_hash     text NOT NULL UNIQUE CHECK (length(key_hash) = 64),
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz,
  last_used_at timestamptz,
  revoked_at   timestamptz
);
CREATE INDEX api_keys_org ON api_keys (org_id, created_at DESC);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON api_keys
  USING (org_id = wds_ctx_org()) WITH CHECK (org_id = wds_ctx_org());
CREATE POLICY key_by_hash ON api_keys FOR SELECT
  USING (key_hash = wds_ctx_apikey());
CREATE POLICY key_touch ON api_keys FOR UPDATE
  USING (key_hash = wds_ctx_apikey()) WITH CHECK (key_hash = wds_ctx_apikey());

GRANT SELECT, INSERT ON api_keys TO wds_app;
GRANT UPDATE (last_used_at, revoked_at) ON api_keys TO wds_app;
