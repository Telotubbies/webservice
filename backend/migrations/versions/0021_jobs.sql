-- 0021 - internal job queue for background work (roadmap §12: one runner for
-- notifications, reports, retention, exports, webhook retries). Producers
-- enqueue inside tenant_tx (wds_app) or as wds_system; workers claim rows by
-- kind. Tenants never query this table — delivery state they can see lives in
-- feature tables. Applied by 0021_jobs.py as wds_owner in one transaction.

CREATE TABLE jobs (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id       uuid REFERENCES organizations (id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (length(kind) BETWEEN 1 AND 60),
  payload      jsonb NOT NULL DEFAULT '{}',
  run_at       timestamptz NOT NULL DEFAULT now(),
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'running', 'done', 'dead')),
  attempts     integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 25),
  last_error   text CHECK (last_error IS NULL OR length(last_error) <= 4000),
  created_at   timestamptz NOT NULL DEFAULT now(),
  done_at      timestamptz,
  locked_at    timestamptz                          -- set by the claimer; the
                                                    -- reaper flips 'running'
                                                    -- rows older than 10min
                                                    -- back to 'pending'
);
CREATE INDEX jobs_due ON jobs (run_at) WHERE status = 'pending';
CREATE INDEX jobs_org ON jobs (org_id, created_at DESC);

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON jobs
  USING (org_id = wds_ctx_org()) WITH CHECK (org_id = wds_ctx_org());
-- wds_system sees and writes every row (org-scoped and org-less jobs).
CREATE POLICY system_all ON jobs
  FOR ALL TO wds_system USING (true) WITH CHECK (true);

-- wds_app enqueues (INSERT) and may cancel its own pending jobs (DELETE, e.g.
-- org restore cancelling a queued org_purge); claim/complete/fail run only as
-- wds_system in the job runner — no UPDATE grant for wds_app.
GRANT SELECT, INSERT, DELETE ON jobs TO wds_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON jobs TO wds_system;
