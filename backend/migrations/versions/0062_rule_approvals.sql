-- 0062 - critical alarm rules need a second person (F11).
-- A critical rule is created disabled with approval='pending'; the engine only
-- loads enabled rules, so it cannot fire until someone other than the author
-- approves it. alarm_rule_approvals records each request and decision; the
-- CHECK makes "author approves own rule" impossible even for a direct SQL write.
-- Applied by 0062_rule_approvals.py as wds_owner in one transaction.

ALTER TABLE alarm_rules
  ADD COLUMN approval text NOT NULL DEFAULT 'approved'
  CHECK (approval IN ('approved', 'pending', 'rejected'));

CREATE TABLE alarm_rule_approvals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL,
  rule_id      uuid NOT NULL,
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decision     text CHECK (decision IN ('approved', 'rejected')),
  decided_by   uuid,
  decided_at   timestamptz,
  reason       text CHECK (reason IS NULL OR length(reason) <= 500),
  CHECK ((decision IS NULL) = (decided_by IS NULL)),
  CHECK (decided_by IS NULL OR decided_by <> requested_by),
  FOREIGN KEY (org_id, rule_id) REFERENCES alarm_rules (org_id, id) ON DELETE CASCADE
);
-- one open request per rule
CREATE UNIQUE INDEX alarm_rule_approvals_open ON alarm_rule_approvals (rule_id) WHERE decision IS NULL;

ALTER TABLE alarm_rule_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE alarm_rule_approvals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON alarm_rule_approvals USING (org_id = wds_ctx_org())
  WITH CHECK (org_id = wds_ctx_org());
GRANT SELECT, INSERT, UPDATE, DELETE ON alarm_rule_approvals TO wds_app;
