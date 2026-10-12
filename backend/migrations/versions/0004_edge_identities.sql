-- 0004 — edge_identities: one MQTT dynsec credential per edge per version
-- (doc 17 §2/§5). Applied by 0004_edge_identities.py as wds_owner inside
-- one transaction. RLS shape mirrors edges in 0001_saas_schema.sql.
--
-- The broker username is edge-{edge_id}-v{n}; the secret itself is NEVER
-- stored — only its sha256 fingerprint. `secret_issued=false` marks a
-- credential the reconciler had to recreate after broker-side loss: it is
-- live in the broker but nobody holds the secret — the edge shows
-- "needs_rotation" until an admin rotates (doc 17 §6).

CREATE TABLE edge_identities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  edge_id       uuid NOT NULL,
  version       integer NOT NULL,
  username      text NOT NULL UNIQUE,               -- edge-{edge_uuid}-v{n}
  fingerprint   text,                               -- sha256 hex; never the secret
  status        text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'grace', 'disabled', 'lost')),
  secret_issued boolean NOT NULL DEFAULT true,      -- false => needs_rotation
  grace_until   timestamptz,                        -- set when rotated away
  rotated_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, edge_id, version),
  FOREIGN KEY (org_id, edge_id) REFERENCES edges (org_id, id) ON DELETE CASCADE
);
CREATE INDEX edge_identities_edge ON edge_identities (org_id, edge_id, version DESC);

-- Fail-closed tenant isolation — no context → no rows, writes rejected.
ALTER TABLE edge_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE edge_identities FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON edge_identities
  USING (org_id = wds_ctx_org()) WITH CHECK (org_id = wds_ctx_org());

-- wds_system pre-context lookups (reconciler desired-state read), mirroring
-- system_edge_lookup in 0001.
CREATE POLICY system_edge_identity_lookup ON edge_identities
  FOR SELECT TO wds_system USING (true);

-- Grants (least privilege). Nothing is owned by wds_app / wds_system.
GRANT SELECT, INSERT, UPDATE, DELETE ON edge_identities TO wds_app;
GRANT SELECT, INSERT, UPDATE ON edge_identities TO wds_system;
