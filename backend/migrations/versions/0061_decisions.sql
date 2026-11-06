-- 0061 - decisions (F10): a person's recorded choice between compared options
-- (refill now / later / switch source). The numbers shown at decision time are
-- stored as a snapshot so the record stays explainable after the data moves on.
-- Nothing here triggers an action; sending a command stays on the F05 path.

CREATE TABLE decisions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  site_id     uuid NOT NULL,
  subject     text NOT NULL CHECK (length(subject) BETWEEN 1 AND 200),
  option_key  text NOT NULL CHECK (option_key IN ('refill_now', 'refill_later', 'switch_source')),
  reason      text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  snapshot    jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object' AND octet_length(snapshot::text) <= 32768),
  decided_by  uuid,
  decided_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, site_id) REFERENCES sites (org_id, id) ON DELETE CASCADE
);
CREATE INDEX decisions_site_time ON decisions (org_id, site_id, decided_at DESC);

ALTER TABLE decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON decisions USING (org_id = wds_ctx_org())
  WITH CHECK (org_id = wds_ctx_org());
GRANT SELECT, INSERT ON decisions TO wds_app;
