-- 0001 — multi-tenant schema (ADR-13, doc 16, doc 18 §4).
-- Applied by 0001_saas_schema.py as wds_owner inside one transaction.

-- ---------------------------------------------------------------------------
-- Context accessors. NULL when unset or empty → every tenant policy predicate
-- evaluates to NULL → no rows visible, writes rejected (fail-closed).
-- The ONLY place these settings are written is backend/app/db/context.py.
-- ---------------------------------------------------------------------------
CREATE FUNCTION wds_ctx_org() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('app.org_id', true), '')::uuid $$;
CREATE FUNCTION wds_ctx_user() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;
CREATE FUNCTION wds_ctx_invite() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('app.invite_hash', true), '') $$;

-- ---------------------------------------------------------------------------
-- Global (non-tenant) tables
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sub            text NOT NULL UNIQUE,                 -- IdP subject
  email          text,
  email_verified boolean NOT NULL DEFAULT false,
  display_name   text,
  locale         text NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'th')),
  disabled_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE revoked_sessions (
  sid        text PRIMARY KEY,
  revoked_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------
CREATE TABLE organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  plan_limits jsonb NOT NULL DEFAULT '{"max_sites": 5, "max_edges": 10, "max_tags": 500}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE TABLE memberships (
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('owner', 'admin', 'operator', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX memberships_user ON memberships (user_id);

CREATE TABLE invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email       text NOT NULL,
  role        text NOT NULL CHECK (role IN ('admin', 'operator', 'viewer')),
  token_hash  text NOT NULL UNIQUE,                    -- sha256 hex; raw token never stored
  invited_by  uuid REFERENCES users(id),
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id)
);

-- ---------------------------------------------------------------------------
-- Plant model — every child references (org_id, parent_id) so a cross-tenant
-- relationship cannot be stored (ADR-13 §4).
-- ---------------------------------------------------------------------------
CREATE TABLE sites (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  code            text NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9_-]{0,31}$'),  -- display only
  timezone        text NOT NULL DEFAULT 'UTC',
  control_enabled boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, code)
);

CREATE TABLE lines (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id  uuid NOT NULL,
  site_id uuid NOT NULL,
  name    text NOT NULL,
  UNIQUE (org_id, id),
  UNIQUE (org_id, site_id, name),
  FOREIGN KEY (org_id, site_id) REFERENCES sites (org_id, id) ON DELETE CASCADE
);

CREATE TABLE devices (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id  uuid NOT NULL,
  line_id uuid NOT NULL,
  name    text NOT NULL,
  UNIQUE (org_id, id),
  UNIQUE (org_id, line_id, name),
  FOREIGN KEY (org_id, line_id) REFERENCES lines (org_id, id) ON DELETE CASCADE
);

CREATE TABLE edges (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL,
  site_id                uuid NOT NULL,
  name                   text NOT NULL,
  status                 text NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'active', 'disabled')),
  mqtt_username          text UNIQUE,
  credential_version     integer NOT NULL DEFAULT 0,
  credential_fingerprint text,                         -- sha256 of secret; never the secret
  last_hb_at             timestamptz,
  clock_ok               boolean,
  adapter                text,
  buffer_depth           integer,
  buffer_dropped         bigint,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, site_id, id),
  FOREIGN KEY (org_id, site_id) REFERENCES sites (org_id, id) ON DELETE CASCADE
);

CREATE TABLE tags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  site_id     uuid NOT NULL,
  edge_id     uuid,
  device_id   uuid,
  path        text NOT NULL CHECK (path ~ '^[a-z0-9_]+(/[a-z0-9_]+){1,7}$'),
  name        text NOT NULL,
  type        text NOT NULL CHECK (type IN ('bool', 'number')),
  unit        text,
  writable    boolean NOT NULL DEFAULT false,
  min_value   double precision,
  max_value   double precision,
  step_value  double precision,
  enum_values jsonb,
  requires    jsonb NOT NULL DEFAULT '[]',
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, site_id, id),
  UNIQUE (org_id, site_id, path),
  CHECK (min_value IS NULL OR max_value IS NULL OR min_value <= max_value),
  FOREIGN KEY (org_id, site_id) REFERENCES sites (org_id, id) ON DELETE CASCADE,
  -- the edge must be in the SAME site as the tag
  FOREIGN KEY (org_id, site_id, edge_id) REFERENCES edges (org_id, site_id, id),
  FOREIGN KEY (org_id, device_id) REFERENCES devices (org_id, id)
);

-- ---------------------------------------------------------------------------
-- Telemetry
-- ---------------------------------------------------------------------------
CREATE TABLE tag_latest (
  tag_id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  v      jsonb NOT NULL,
  q      text NOT NULL CHECK (q IN ('good', 'bad', 'stale', 'uncertain')),
  ts     timestamptz NOT NULL,
  FOREIGN KEY (org_id, tag_id) REFERENCES tags (org_id, id) ON DELETE CASCADE
);

CREATE TABLE tag_history (
  tag_id uuid NOT NULL,
  ts     timestamptz NOT NULL,
  org_id uuid NOT NULL,
  v      jsonb NOT NULL,
  q      text NOT NULL CHECK (q IN ('good', 'bad', 'stale', 'uncertain')),
  PRIMARY KEY (tag_id, ts),                            -- QoS1 replay dedup (I10)
  FOREIGN KEY (org_id, tag_id) REFERENCES tags (org_id, id) ON DELETE CASCADE
);
CREATE INDEX tag_history_ts_brin ON tag_history USING brin (ts);

-- ---------------------------------------------------------------------------
-- Alarms
-- ---------------------------------------------------------------------------
CREATE TABLE alarm_rules (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id    uuid NOT NULL,
  tag_id    uuid NOT NULL,
  name      text NOT NULL,
  kind      text NOT NULL CHECK (kind IN ('hi', 'hihi', 'lo', 'lolo', 'stale')),
  threshold double precision,
  stale_s   integer CHECK (stale_s IS NULL OR stale_s BETWEEN 5 AND 86400),
  deadband  double precision NOT NULL DEFAULT 0 CHECK (deadband >= 0),
  severity  text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  enabled   boolean NOT NULL DEFAULT true,
  UNIQUE (org_id, id),
  UNIQUE (org_id, tag_id, id),
  UNIQUE (org_id, tag_id, name),
  CHECK ((kind = 'stale' AND stale_s IS NOT NULL) OR (kind <> 'stale' AND threshold IS NOT NULL)),
  FOREIGN KEY (org_id, tag_id) REFERENCES tags (org_id, id) ON DELETE CASCADE
);

CREATE TABLE alarms (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL,
  tag_id     uuid NOT NULL,
  rule_id    uuid NOT NULL,
  severity   text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  state      text NOT NULL CHECK (state IN ('active', 'acked', 'cleared')),
  raised_at  timestamptz NOT NULL,
  acked_at   timestamptz,
  acked_by   uuid REFERENCES users(id),
  cleared_at timestamptz,
  version    integer NOT NULL DEFAULT 1,
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, tag_id) REFERENCES tags (org_id, id) ON DELETE CASCADE,
  -- the rule must belong to the SAME tag
  FOREIGN KEY (org_id, tag_id, rule_id) REFERENCES alarm_rules (org_id, tag_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX alarms_one_open_per_rule ON alarms (org_id, rule_id)
  WHERE state IN ('active', 'acked');
CREATE INDEX alarms_org_state ON alarms (org_id, state, raised_at DESC);

-- ---------------------------------------------------------------------------
-- Commands (doc 16)
-- ---------------------------------------------------------------------------
CREATE TABLE commands (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  site_id         uuid NOT NULL,
  edge_id         uuid NOT NULL,
  tag_id          uuid NOT NULL,
  value           jsonb NOT NULL,
  status          text NOT NULL CHECK (status IN
                    ('accepted', 'dispatched', 'acknowledged', 'rejected', 'failed', 'timeout')),
  reason          text,
  ttl_s           integer NOT NULL CHECK (ttl_s BETWEEN 1 AND 60),
  idempotency_key text CHECK (idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 64),
  note            text CHECK (note IS NULL OR length(note) <= 200),
  actor_user_id   uuid NOT NULL REFERENCES users(id),
  issued_at       timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL,
  version         integer NOT NULL DEFAULT 1,
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, site_id, tag_id) REFERENCES tags (org_id, site_id, id),
  FOREIGN KEY (org_id, site_id, edge_id) REFERENCES edges (org_id, site_id, id)
);
-- One in-flight command per tag (I8). In-flight = accepted | dispatched.
CREATE UNIQUE INDEX commands_one_inflight_per_tag ON commands (org_id, tag_id)
  WHERE status IN ('accepted', 'dispatched');
CREATE UNIQUE INDEX commands_idempotency ON commands (org_id, actor_user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX commands_org_issued ON commands (org_id, issued_at DESC);

CREATE TABLE command_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id      uuid NOT NULL,
  command_id  uuid NOT NULL,
  from_status text,
  to_status   text NOT NULL,
  actor       text NOT NULL,                           -- user:{id} | relay | edge:{id} | sweeper
  reason      text,
  at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (org_id, command_id) REFERENCES commands (org_id, id)
);
CREATE INDEX command_events_cmd ON command_events (org_id, command_id, id);

CREATE TABLE command_outbox (
  command_id uuid PRIMARY KEY,
  org_id     uuid NOT NULL,
  topic      text NOT NULL,
  payload    jsonb NOT NULL,
  not_after  timestamptz NOT NULL,
  attempts   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, command_id) REFERENCES commands (org_id, id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Audit log — append-only + per-org hash chain (doc 18 §4)
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id    uuid NOT NULL REFERENCES organizations(id),
  seq       bigint NOT NULL,                           -- per-org chain position
  at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor     text NOT NULL,
  action    text NOT NULL,
  target    jsonb,
  detail    jsonb,
  prev_hash text,
  hash      text NOT NULL,
  UNIQUE (org_id, seq)
);
CREATE INDEX audit_log_org_at ON audit_log (org_id, at DESC);

CREATE FUNCTION audit_row_hash(prev text, org uuid, seq bigint, at timestamptz,
                               actor text, action text, target jsonb, detail jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(concat_ws('|',
    coalesce(prev, ''), org::text, seq::text,
    to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    actor, action, coalesce(target::text, ''), coalesce(detail::text, '')), 'UTF8')), 'hex')
$$;

CREATE FUNCTION audit_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  last_seq  bigint;
  last_hash text;
BEGIN
  -- Serialize writers per org so the chain is linear.
  PERFORM pg_advisory_xact_lock(hashtext('wds.audit:' || NEW.org_id::text));
  SELECT a.seq, a.hash INTO last_seq, last_hash
    FROM audit_log a WHERE a.org_id = NEW.org_id ORDER BY a.seq DESC LIMIT 1;
  NEW.seq       := coalesce(last_seq, 0) + 1;
  NEW.at        := clock_timestamp();
  NEW.prev_hash := last_hash;
  NEW.hash      := audit_row_hash(last_hash, NEW.org_id, NEW.seq, NEW.at,
                                  NEW.actor, NEW.action, NEW.target, NEW.detail);
  RETURN NEW;
END $$;

CREATE TRIGGER audit_log_chain BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_chain();

CREATE FUNCTION wds_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% rejected)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER audit_log_immutable BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION wds_reject_mutation();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION wds_reject_mutation();
CREATE TRIGGER command_events_immutable BEFORE UPDATE OR DELETE ON command_events
  FOR EACH ROW EXECUTE FUNCTION wds_reject_mutation();
CREATE TRIGGER command_events_no_truncate BEFORE TRUNCATE ON command_events
  FOR EACH STATEMENT EXECUTE FUNCTION wds_reject_mutation();

-- ---------------------------------------------------------------------------
-- Row-level security: ENABLE + FORCE on every tenant table, fail-closed.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organizations', 'memberships', 'invites', 'sites', 'lines', 'devices', 'edges',
    'tags', 'tag_latest', 'tag_history', 'alarm_rules', 'alarms', 'commands',
    'command_events', 'command_outbox', 'audit_log'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    IF t <> 'organizations' THEN
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I USING (org_id = wds_ctx_org()) '
        'WITH CHECK (org_id = wds_ctx_org())', t);
    END IF;
  END LOOP;
END $$;

-- organizations: the row whose id is the context, plus read access to orgs the
-- context user belongs to (for /me and the org switcher).
CREATE POLICY org_self ON organizations
  USING (id = wds_ctx_org()) WITH CHECK (id = wds_ctx_org());
CREATE POLICY org_member_read ON organizations FOR SELECT
  USING (id IN (SELECT m.org_id FROM memberships m WHERE m.user_id = wds_ctx_user()));
CREATE POLICY member_self_read ON memberships FOR SELECT
  USING (user_id = wds_ctx_user());
CREATE POLICY invite_by_token ON invites FOR SELECT
  USING (token_hash = wds_ctx_invite());

-- wds_system pre-context lookups (ADR-13 §3), narrowed by column grants below.
CREATE POLICY system_org_list ON organizations FOR SELECT TO wds_system USING (true);
CREATE POLICY system_edge_lookup ON edges FOR SELECT TO wds_system USING (true);

-- ---------------------------------------------------------------------------
-- Grants (least privilege). Nothing is owned by wds_app / wds_system.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON users TO wds_app;
GRANT SELECT, INSERT ON revoked_sessions TO wds_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  organizations, memberships, invites, sites, lines, devices, edges, tags, alarm_rules
  TO wds_app;
GRANT SELECT, INSERT, UPDATE ON tag_latest, alarms, commands TO wds_app;
GRANT SELECT, INSERT ON tag_history, command_events, audit_log TO wds_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON command_outbox TO wds_app;

GRANT SELECT (id, sub, disabled_at) ON users TO wds_system;
GRANT SELECT ON revoked_sessions TO wds_system;
GRANT SELECT (id, deleted_at) ON organizations TO wds_system;
GRANT SELECT ON sites, lines, devices, tags, alarm_rules TO wds_system;
GRANT SELECT (id, org_id, site_id, status, mqtt_username, credential_version,
              credential_fingerprint, last_hb_at, clock_ok, adapter,
              buffer_depth, buffer_dropped)
  ON edges TO wds_system;
GRANT UPDATE (status, mqtt_username, credential_version, credential_fingerprint,
              last_hb_at, clock_ok, adapter, buffer_depth, buffer_dropped)
  ON edges TO wds_system;
GRANT SELECT, INSERT, UPDATE ON tag_latest, alarms, commands TO wds_system;
GRANT SELECT, INSERT ON tag_history, command_events, audit_log TO wds_system;
GRANT SELECT, UPDATE, DELETE ON command_outbox TO wds_system;
