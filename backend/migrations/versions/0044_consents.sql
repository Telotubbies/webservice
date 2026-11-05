-- 0044 - legal consent records (roadmap 8.1): which version of each legal
-- document a user accepted, and when. User-scoped (not org-scoped): consent
-- belongs to the account, so the RLS predicate is wds_ctx_user() — the same
-- shape as memberships.member_self_read, and it fails closed when no user
-- context is set (user_tx / set_key_user are the only writers).
-- Applied by 0044_consents.py as wds_owner in one transaction.

CREATE TABLE consents (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc          text NOT NULL CHECK (doc IN ('tos', 'privacy')),
  version      text NOT NULL CHECK (version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  consented_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, doc)
);

-- Fail-closed: no user context -> no rows, writes rejected.
ALTER TABLE consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE consents FORCE ROW LEVEL SECURITY;
CREATE POLICY consent_self ON consents
  USING (user_id = wds_ctx_user()) WITH CHECK (user_id = wds_ctx_user());

-- Only the app role touches consents; wds_system never does (it has no
-- user context to satisfy the policy anyway).
GRANT SELECT, INSERT, UPDATE ON consents TO wds_app;
