-- 0034 - support access sessions (roadmap §11 7.2): a time-boxed, reasoned,
-- read-only window in which a platform admin may look into one tenant.
-- Visible to the tenant (members can SELECT the org's rows) and mirrored into
-- the tenant's audit_log by the issuing endpoint.
-- Applied by 0034_support_sessions.py as wds_owner in one transaction.

CREATE TABLE support_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  admin_user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  reason        text NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
  read_only     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  -- spec: time-boxed to one hour; the bound is structural, not app policy
  CHECK (expires_at <= created_at + interval '1 hour'),
  CHECK (expires_at > created_at)
);
CREATE INDEX support_sessions_org ON support_sessions (org_id, created_at DESC);
CREATE INDEX support_sessions_live ON support_sessions (admin_user_id)
  WHERE revoked_at IS NULL;

ALTER TABLE support_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_sessions FORCE ROW LEVEL SECURITY;
-- tenant read: the org's members see who has a support window into their org
CREATE POLICY tenant_isolation ON support_sessions
  FOR SELECT TO wds_app USING (org_id = wds_ctx_org());
-- the back-office issues/revokes as wds_system (the admin holds no membership)
CREATE POLICY system_all ON support_sessions FOR ALL TO wds_system
  USING (true) WITH CHECK (true);

GRANT SELECT ON support_sessions TO wds_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON support_sessions TO wds_system;
