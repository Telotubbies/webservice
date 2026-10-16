-- 0032 - plans catalog, per-org plan + lifecycle columns, platform admin
-- roster (roadmap §10 plans, §11.1 back-office).
--
-- `plans` is the seeded catalog (NULL cap = unlimited/custom). The org's
-- effective cap is plan_limits->>'<key>' when set (per-org override, e.g.
-- enterprise custom terms), else the plan row. NULL resolved cap = unlimited.
-- `suspended_at`/`deleted_at` drive the OrgGuard middleware + purge worker.
-- Applied by 0032_plans_platform.py as wds_owner in one transaction.

CREATE TABLE plans (
  code              text PRIMARY KEY CHECK (code ~ '^[a-z]+$'),
  name              text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  trial_days        integer NOT NULL DEFAULT 0 CHECK (trial_days >= 0),
  max_sites         integer CHECK (max_sites IS NULL OR max_sites >= 0),
  max_edges         integer CHECK (max_edges IS NULL OR max_edges >= 0),
  max_tags          integer CHECK (max_tags IS NULL OR max_tags >= 0),
  max_users         integer CHECK (max_users IS NULL OR max_users >= 0),
  max_cameras       integer CHECK (max_cameras IS NULL OR max_cameras >= 0),
  max_vision_models integer CHECK (max_vision_models IS NULL OR max_vision_models >= 0),
  retention_days    integer CHECK (retention_days IS NULL OR retention_days >= 1),
  gpu_hours_monthly double precision NOT NULL DEFAULT 0 CHECK (gpu_hours_monthly >= 0),
  sso               boolean NOT NULL DEFAULT false,
  audit_export      boolean NOT NULL DEFAULT false,
  sms               boolean NOT NULL DEFAULT false,
  assistant         boolean NOT NULL DEFAULT false,
  api_rate_per_min  integer NOT NULL DEFAULT 120 CHECK (api_rate_per_min >= 1)
);

-- roadmap §10 6.1 table (placeholders to be validated with pilot customers).
-- NULL numeric cap = unlimited (enterprise users) or 'custom' (enterprise
-- negotiation: the platform PATCH writes plan_limits overrides instead).
INSERT INTO plans (code, name, trial_days,
                   max_sites, max_edges, max_tags, max_users,
                   max_cameras, max_vision_models, retention_days,
                   gpu_hours_monthly, sso, audit_export, sms, assistant,
                   api_rate_per_min) VALUES
  ('trial',      'Trial',      14,  1,    1,   100,  5,    1,   1,  7,    2, false, false, false, false,  60),
  ('starter',    'Starter',    0,   1,    2,   500,  10,   2,   2,  90,   0, false, false, false, false, 120),
  ('pro',        'Pro',        0,   5,   10,  5000, 50,   20,  10, 365,  20, true,  true,  false, false, 600),
  ('enterprise', 'Enterprise', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, true,  true,  true,  true, 2400);

-- ---------------------------------------------------------------------------
-- organizations: plan + lifecycle
-- ---------------------------------------------------------------------------
ALTER TABLE organizations
  ADD COLUMN plan             text NOT NULL DEFAULT 'trial'
                              REFERENCES plans (code),
  ADD COLUMN trial_ends_at    timestamptz,
  ADD COLUMN suspended_at     timestamptz,
  ADD COLUMN suspended_reason text CHECK (suspended_reason IS NULL OR length(suspended_reason) <= 500);

-- new orgs on the trial plan get a 14-day trial window by default.
-- FORCE RLS applies to the table owner too and this migration has no org
-- context (wds_ctx_org() is NULL → every row invisible → silent no-op), so
-- lift FORCE for the backfill (same transaction, restored right after —
-- the 0014/0015 pattern).
ALTER TABLE organizations NO FORCE ROW LEVEL SECURITY;
UPDATE organizations SET trial_ends_at = created_at + interval '14 days'
  WHERE plan = 'trial' AND trial_ends_at IS NULL;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;

-- The back-office reads and manages every tenant as wds_system. The
-- pre-context read stays column-narrow; this widens it to the admin fields.
GRANT SELECT (name, slug, plan, plan_limits, timezone, language,
              created_at, trial_ends_at, suspended_at, suspended_reason)
  ON organizations TO wds_system;
CREATE POLICY system_org_update ON organizations FOR UPDATE TO wds_system
  USING (true) WITH CHECK (true);
GRANT UPDATE (name, plan, plan_limits, trial_ends_at,
              suspended_at, suspended_reason) ON organizations TO wds_system;

-- ---------------------------------------------------------------------------
-- plans: world-readable catalog (it is product copy, not tenant data),
-- writable only by migrations / wds_system (back-office seed tooling).
-- ---------------------------------------------------------------------------
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans FORCE ROW LEVEL SECURITY;
CREATE POLICY plans_read ON plans FOR SELECT USING (true);
CREATE POLICY system_all ON plans FOR ALL TO wds_system USING (true) WITH CHECK (true);
GRANT SELECT ON plans TO wds_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON plans TO wds_system;

-- ---------------------------------------------------------------------------
-- platform_admins: WDS staff who may use /api/v1/platform. Global table —
-- membership in it is itself the cross-tenant grant, so no org_id.
-- A caller may read only their own row (the "am I an admin" check);
-- roster management runs as wds_system.
-- ---------------------------------------------------------------------------
CREATE TABLE platform_admins (
  user_id    uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  note       text NOT NULL DEFAULT '' CHECK (length(note) <= 200),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_admins FORCE ROW LEVEL SECURITY;
CREATE POLICY self_admin_read ON platform_admins FOR SELECT
  USING (user_id = wds_ctx_user());
CREATE POLICY system_all ON platform_admins FOR ALL TO wds_system
  USING (true) WITH CHECK (true);
GRANT SELECT ON platform_admins TO wds_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_admins TO wds_system;
