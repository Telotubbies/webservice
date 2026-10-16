-- 0035 - per-tenant feature flags + in-app announcements (roadmap §11 7.3).
--
-- org_feature_flags: runtime paid add-ons / rollouts per org — replaces
-- build-time VITE_FEATURES for tenant-gated features. Members read their
-- org's flags; only the platform (wds_system) writes them.
--
-- announcements: maintenance/banner notices. org_id NULL = shown to every
-- tenant. Members read rows that are global or their own org's; only the
-- platform writes.
-- Applied by 0035_org_ops.py as wds_owner in one transaction.

CREATE TABLE org_feature_flags (
  org_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  flag       text NOT NULL CHECK (flag ~ '^[a-z0-9_.-]{1,60}$'),
  enabled    boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, flag)
);

ALTER TABLE org_feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_feature_flags FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON org_feature_flags
  FOR SELECT TO wds_app USING (org_id = wds_ctx_org());
CREATE POLICY system_all ON org_feature_flags FOR ALL TO wds_system
  USING (true) WITH CHECK (true);
GRANT SELECT ON org_feature_flags TO wds_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON org_feature_flags TO wds_system;


CREATE TABLE announcements (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid REFERENCES organizations (id) ON DELETE CASCADE,
  title      text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body       text NOT NULL DEFAULT '' CHECK (length(body) <= 2000),
  severity   text NOT NULL DEFAULT 'info'
             CHECK (severity IN ('info', 'warning', 'critical')),
  starts_at  timestamptz NOT NULL DEFAULT now(),
  ends_at    timestamptz,
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX announcements_active ON announcements (starts_at DESC)
  WHERE revoked_at IS NULL;

ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements FORCE ROW LEVEL SECURITY;
-- members see announcements aimed at their org plus global (org_id NULL)
-- ones — but only inside a tenant context; a context-less wds_app read sees
-- nothing (fail closed, same as tenant_isolation elsewhere).
CREATE POLICY announce_member_read ON announcements
  FOR SELECT TO wds_app
  USING (wds_ctx_org() IS NOT NULL
         AND (org_id IS NULL OR org_id = wds_ctx_org()));
CREATE POLICY system_all ON announcements FOR ALL TO wds_system
  USING (true) WITH CHECK (true);
GRANT SELECT ON announcements TO wds_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON announcements TO wds_system;
