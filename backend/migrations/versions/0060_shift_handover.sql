-- 0060 - shift handover (F09). The outgoing person signs a snapshot of the open
-- work; a different person then accepts it. Once both have signed the row is
-- frozen: a trigger rejects any UPDATE or DELETE of a completed row, and the
-- outgoing half can never change after it is set. Every step is also written to
-- audit_log by the API. Applied by 0060_shift_handover.py as wds_owner.

CREATE TABLE shift_handovers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  site_id       uuid NOT NULL,
  outgoing_by   uuid NOT NULL,
  outgoing_name text NOT NULL,
  outgoing_at   timestamptz NOT NULL DEFAULT now(),
  note          text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  snapshot      jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object' AND octet_length(snapshot::text) <= 262144),
  incoming_by   uuid,
  incoming_name text,
  incoming_at   timestamptz,
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, site_id) REFERENCES sites (org_id, id) ON DELETE CASCADE,
  CHECK ((incoming_by IS NULL) = (incoming_at IS NULL)
         AND (incoming_name IS NULL) = (incoming_at IS NULL)),
  CHECK (incoming_by IS NULL OR incoming_by <> outgoing_by)
);
CREATE INDEX shift_handovers_site ON shift_handovers (org_id, site_id, outgoing_at DESC);

CREATE FUNCTION shift_handovers_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  outgoing_new jsonb;
  outgoing_old jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'shift handover is signed and immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.incoming_at IS NOT NULL THEN
    RAISE EXCEPTION 'shift handover is signed and immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  outgoing_new := to_jsonb(NEW) - 'incoming_by' - 'incoming_name' - 'incoming_at';
  outgoing_old := to_jsonb(OLD) - 'incoming_by' - 'incoming_name' - 'incoming_at';
  IF outgoing_new IS DISTINCT FROM outgoing_old THEN
    RAISE EXCEPTION 'shift handover is signed and immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER shift_handovers_guard BEFORE UPDATE OR DELETE ON shift_handovers
  FOR EACH ROW EXECUTE FUNCTION shift_handovers_guard();

ALTER TABLE shift_handovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_handovers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON shift_handovers
  USING (org_id = wds_ctx_org()) WITH CHECK (org_id = wds_ctx_org());
GRANT SELECT, INSERT, UPDATE ON shift_handovers TO wds_app;
