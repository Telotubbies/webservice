-- 0033 - plan-limit enforcement for member seats (roadmap §10 6.2).
--
-- The member/invite create paths live in request handlers that count seats
-- only for the seat resource: a DB trigger is the structural backstop so
-- EVERY membership insert (invite accept, API-key service account excluded,
-- seed/bootstrap) is checked regardless of the code path.
-- Applied by 0033_member_plan_cap.py as wds_owner in one transaction.

-- Resolve the org's effective cap for one resource: the per-org
-- plan_limits override wins, else the plan row. NULL = unlimited.
-- Readable under every context the triggers run in (tenant_tx sets
-- app.org_id -> org_self; wds_system reads via system_org_list).
CREATE FUNCTION wds_plan_cap(org uuid, cap_key text) RETURNS integer
LANGUAGE plpgsql STABLE AS $$
DECLARE
  raw      text;
  ovrd     integer;
  fallback integer;
BEGIN
  SELECT o.plan_limits ->> cap_key,
         CASE cap_key
           WHEN 'max_sites'         THEN p.max_sites
           WHEN 'max_edges'         THEN p.max_edges
           WHEN 'max_tags'          THEN p.max_tags
           WHEN 'max_users'         THEN p.max_users
           WHEN 'max_cameras'       THEN p.max_cameras
           WHEN 'max_vision_models' THEN p.max_vision_models
           ELSE NULL END
    INTO raw, fallback
    FROM organizations o LEFT JOIN plans p ON p.code = o.plan
   WHERE o.id = org;
  IF raw IS NULL OR raw = '' THEN
    RETURN fallback;
  END IF;
  -- plan_limits is jsonb: a malformed override must fail loudly here, not
  -- 500 the insert with an unhandled cast error (app-side validation writes
  -- ints, anything else is operator error or corruption).
  BEGIN
    ovrd := raw::int;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'plan_limit:invalid_override %=%', cap_key, raw
      USING ERRCODE = 'check_violation';
  END;
  IF ovrd < 0 THEN
    RAISE EXCEPTION 'plan_limit:invalid_override %=%', cap_key, raw
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN ovrd;
END $$;

CREATE FUNCTION wds_member_cap_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  cap integer;
  n   integer;
BEGIN
  -- serialize count-then-insert per org: two concurrent seat claims under
  -- READ COMMITTED must not both pass the cap check.
  PERFORM pg_advisory_xact_lock(hashtext('wds.plan_cap:' || NEW.org_id::text));
  -- service accounts (api_keys' svc: users) don't consume seats
  IF TG_TABLE_NAME = 'memberships' AND EXISTS (
       SELECT 1 FROM users u WHERE u.id = NEW.user_id AND u.sub LIKE 'svc:%') THEN
    RETURN NEW;
  END IF;
  cap := wds_plan_cap(NEW.org_id, 'max_users');
  IF cap IS NULL THEN
    RETURN NEW;                       -- unlimited plan / org gone
  END IF;
  -- service accounts (api_keys' svc: users) don't consume seats
  SELECT count(*) INTO n
    FROM memberships m JOIN users u ON u.id = m.user_id
   WHERE m.org_id = NEW.org_id AND u.sub NOT LIKE 'svc:%';
  -- pending invites hold a seat too, so a burst of invites can't race the cap.
  -- The self-exclusion term references NEW.id, which only exists when the
  -- trigger fires on invites — branch instead of an OR term, because the
  -- planner may evaluate NEW.id even when TG_TABLE_NAME <> 'invites' and
  -- memberships has no id column.
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

CREATE TRIGGER memberships_plan_cap BEFORE INSERT ON memberships
  FOR EACH ROW EXECUTE FUNCTION wds_member_cap_guard();

CREATE TRIGGER invites_plan_cap BEFORE INSERT ON invites
  FOR EACH ROW EXECUTE FUNCTION wds_member_cap_guard();

-- ---------------------------------------------------------------------------
-- edges (gateways): the create handler sits in main.py which can't change in
-- this rollout — enforce max_edges structurally, the same way as seats.
-- Disabled edges don't consume the cap (same rule as plans._USAGE_SQL).
-- ---------------------------------------------------------------------------
CREATE FUNCTION wds_edge_cap_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  cap integer;
  n   integer;
BEGIN
  -- same serialization as the seat guard: count-then-insert is racy under
  -- READ COMMITTED without a per-org lock.
  PERFORM pg_advisory_xact_lock(hashtext('wds.plan_cap:' || NEW.org_id::text));
  cap := wds_plan_cap(NEW.org_id, 'max_edges');
  IF cap IS NULL THEN
    RETURN NEW;                       -- unlimited plan
  END IF;
  SELECT count(*) INTO n FROM edges
   WHERE org_id = NEW.org_id AND status <> 'disabled';
  IF n >= cap THEN
    RAISE EXCEPTION 'plan_limit:max_edges' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER edges_plan_cap BEFORE INSERT ON edges
  FOR EACH ROW EXECUTE FUNCTION wds_edge_cap_guard();
