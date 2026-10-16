-- Re-seating an EXISTING member (INSERT ... ON CONFLICT DO UPDATE, e.g. the boot
-- seed) is not a new seat. The BEFORE INSERT trigger fires before the conflict
-- is resolved, so 0033 counted the existing row against the cap and a full org
-- could no longer restart the backend (seed() -> plan_limit:max_users).
CREATE OR REPLACE FUNCTION wds_member_cap_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  cap integer;
  n   integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('wds.plan_cap:' || NEW.org_id::text));
  -- Nested IFs on purpose: NEW.user_id must never be planned when the trigger
  -- fires on invites (no such column) - 0033's `IF .. AND EXISTS(.. NEW.user_id)`
  -- raised 'record "new" has no field "user_id"' on every invite insert.
  IF TG_TABLE_NAME = 'memberships' THEN
    IF EXISTS (SELECT 1 FROM users u
                WHERE u.id = NEW.user_id AND u.sub LIKE 'svc:%') THEN
      RETURN NEW;                     -- service accounts don't consume seats
    END IF;
    IF EXISTS (SELECT 1 FROM memberships m
                WHERE m.org_id = NEW.org_id AND m.user_id = NEW.user_id) THEN
      RETURN NEW;                     -- already seated: the upsert only updates
    END IF;
  END IF;
  cap := wds_plan_cap(NEW.org_id, 'max_users');
  IF cap IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO n
    FROM memberships m JOIN users u ON u.id = m.user_id
   WHERE m.org_id = NEW.org_id AND u.sub NOT LIKE 'svc:%';
  IF TG_TABLE_NAME = 'invites' THEN
    SELECT n + count(*) INTO n
      FROM invites i
     WHERE i.org_id = NEW.org_id AND i.accepted_at IS NULL
       AND i.expires_at > now() AND i.id <> NEW.id;
  ELSE
    SELECT n + count(*) INTO n
      FROM invites i
     WHERE i.org_id = NEW.org_id AND i.accepted_at IS NULL
       AND i.expires_at > now();
  END IF;
  IF n >= cap THEN
    RAISE EXCEPTION 'plan_limit:max_users' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
