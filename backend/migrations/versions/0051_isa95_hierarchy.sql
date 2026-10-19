-- 0051 - ISA-95 hierarchy (spec 2026-10-19 §5): Site > Area > Line > Equipment.
-- Every line lives in an area; a trigger files un-areaed inserts under the
-- site's "default" area so existing writers (tag import, SQLite migration)
-- keep working. area_grants limit which areas an operator may command.
-- Applied by 0051_isa95_hierarchy.py as wds_owner in one transaction.

CREATE TABLE areas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL,
  site_id    uuid NOT NULL,
  name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  code       text NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9_-]{0,31}$'),
  sort       integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, site_id, code),
  FOREIGN KEY (org_id, site_id) REFERENCES sites (org_id, id) ON DELETE CASCADE
);

ALTER TABLE lines ADD COLUMN area_id uuid;
ALTER TABLE lines ADD COLUMN kind text NOT NULL DEFAULT 'line'
  CHECK (kind IN ('line', 'cell', 'unit'));
ALTER TABLE devices ADD COLUMN kind text
  CHECK (kind IN ('motor', 'conveyor', 'vessel', 'valve', 'pump', 'mixer',
                  'indicator', 'other'));
ALTER TABLE plant_parts ADD COLUMN device_id uuid;
ALTER TABLE plant_parts ADD FOREIGN KEY (org_id, device_id)
  REFERENCES devices (org_id, id) ON DELETE SET NULL (device_id);

-- backfill (owner is subject to FORCE RLS with no tenant context: lift it for
-- the one table we read across orgs, then restore)
ALTER TABLE lines NO FORCE ROW LEVEL SECURITY;
-- one "default" area per site that already has lines
INSERT INTO areas (org_id, site_id, name, code)
SELECT DISTINCT org_id, site_id, 'General', 'default' FROM lines;
UPDATE lines l SET area_id = a.id
  FROM areas a
 WHERE a.org_id = l.org_id AND a.site_id = l.site_id AND a.code = 'default';
ALTER TABLE lines FORCE ROW LEVEL SECURITY;

ALTER TABLE lines ALTER COLUMN area_id SET NOT NULL;
ALTER TABLE lines ADD FOREIGN KEY (org_id, area_id)
  REFERENCES areas (org_id, id) ON DELETE RESTRICT;
CREATE INDEX lines_area ON lines (org_id, area_id);
CREATE INDEX plant_parts_device ON plant_parts (org_id, device_id)
  WHERE device_id IS NOT NULL;

CREATE FUNCTION lines_default_area() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.area_id IS NULL THEN
    INSERT INTO areas (org_id, site_id, name, code)
    VALUES (NEW.org_id, NEW.site_id, 'General', 'default')
    ON CONFLICT (org_id, site_id, code) DO NOTHING;
    SELECT id INTO NEW.area_id FROM areas
     WHERE org_id = NEW.org_id AND site_id = NEW.site_id AND code = 'default';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lines_default_area BEFORE INSERT ON lines
  FOR EACH ROW EXECUTE FUNCTION lines_default_area();

-- "may command area X": no rows for a user = every area (existing orgs keep
-- working); at least one row = only those areas. Enforced in the backend
-- (RLS is the tenant boundary, this is authorization on top of it).
CREATE TABLE area_grants (
  org_id     uuid NOT NULL,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  area_id    uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id, area_id),
  FOREIGN KEY (org_id, area_id) REFERENCES areas (org_id, id) ON DELETE CASCADE
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['areas', 'area_grants'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = wds_ctx_org()) '
                   'WITH CHECK (org_id = wds_ctx_org())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO wds_app', t);
  END LOOP;
END $$;
