--
-- PostgreSQL database dump
--

\restrict Jx2LaFdtRuef0vKKnmqSacIjqwQR8AvNahF3Qce2PFbfUgM2UytqOoPYow80HB7

-- Dumped from database version 16.15
-- Dumped by pg_dump version 16.15


--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

-- *not* creating schema, since initdb creates it


--
-- Name: audit_chain(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_chain() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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


--
-- Name: audit_row_hash(text, uuid, bigint, timestamp with time zone, text, text, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_row_hash(prev text, org uuid, seq bigint, at timestamp with time zone, actor text, action text, target jsonb, detail jsonb) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT encode(sha256(convert_to(concat_ws('|',
    coalesce(prev, ''), org::text, seq::text,
    to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    actor, action, coalesce(target::text, ''), coalesce(detail::text, '')), 'UTF8')), 'hex')
$$;


--
-- Name: wds_ctx_invite(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.wds_ctx_invite() RETURNS text
    LANGUAGE sql STABLE
    AS $$ SELECT NULLIF(current_setting('app.invite_hash', true), '') $$;


--
-- Name: wds_ctx_org(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.wds_ctx_org() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$ SELECT NULLIF(current_setting('app.org_id', true), '')::uuid $$;


--
-- Name: wds_ctx_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.wds_ctx_user() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;


--
-- Name: wds_reject_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.wds_reject_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% rejected)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;




--
-- Name: alarm_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alarm_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    tag_id uuid NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    threshold double precision,
    stale_s integer,
    deadband double precision DEFAULT 0 NOT NULL,
    severity text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    CONSTRAINT alarm_rules_check CHECK ((((kind = 'stale'::text) AND (stale_s IS NOT NULL)) OR ((kind <> 'stale'::text) AND (threshold IS NOT NULL)))),
    CONSTRAINT alarm_rules_deadband_check CHECK ((deadband >= (0)::double precision)),
    CONSTRAINT alarm_rules_kind_check CHECK ((kind = ANY (ARRAY['hi'::text, 'hihi'::text, 'lo'::text, 'lolo'::text, 'stale'::text]))),
    CONSTRAINT alarm_rules_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'warning'::text, 'critical'::text]))),
    CONSTRAINT alarm_rules_stale_s_check CHECK (((stale_s IS NULL) OR ((stale_s >= 5) AND (stale_s <= 86400))))
);

ALTER TABLE ONLY public.alarm_rules FORCE ROW LEVEL SECURITY;


--
-- Name: alarms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alarms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    tag_id uuid NOT NULL,
    rule_id uuid NOT NULL,
    severity text NOT NULL,
    state text NOT NULL,
    raised_at timestamp with time zone NOT NULL,
    acked_at timestamp with time zone,
    acked_by uuid,
    cleared_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT alarms_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'warning'::text, 'critical'::text]))),
    CONSTRAINT alarms_state_check CHECK ((state = ANY (ARRAY['active'::text, 'acked'::text, 'cleared'::text])))
);

ALTER TABLE ONLY public.alarms FORCE ROW LEVEL SECURITY;


--
-- Name: alembic_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alembic_version (
    version_num character varying(32) NOT NULL
);


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id bigint NOT NULL,
    org_id uuid NOT NULL,
    seq bigint NOT NULL,
    at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    actor text NOT NULL,
    action text NOT NULL,
    target jsonb,
    detail jsonb,
    prev_hash text,
    hash text NOT NULL
);

ALTER TABLE ONLY public.audit_log FORCE ROW LEVEL SECURITY;


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.audit_log ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: command_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.command_events (
    id bigint NOT NULL,
    org_id uuid NOT NULL,
    command_id uuid NOT NULL,
    from_status text,
    to_status text NOT NULL,
    actor text NOT NULL,
    reason text,
    at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

ALTER TABLE ONLY public.command_events FORCE ROW LEVEL SECURITY;


--
-- Name: command_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.command_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.command_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: command_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.command_outbox (
    command_id uuid NOT NULL,
    org_id uuid NOT NULL,
    topic text NOT NULL,
    payload jsonb NOT NULL,
    not_after timestamp with time zone NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.command_outbox FORCE ROW LEVEL SECURITY;


--
-- Name: commands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commands (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    site_id uuid NOT NULL,
    edge_id uuid NOT NULL,
    tag_id uuid NOT NULL,
    value jsonb NOT NULL,
    status text NOT NULL,
    reason text,
    ttl_s integer NOT NULL,
    idempotency_key text,
    note text,
    actor_user_id uuid NOT NULL,
    issued_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT commands_idempotency_key_check CHECK (((idempotency_key IS NULL) OR ((length(idempotency_key) >= 1) AND (length(idempotency_key) <= 64)))),
    CONSTRAINT commands_note_check CHECK (((note IS NULL) OR (length(note) <= 200))),
    CONSTRAINT commands_status_check CHECK ((status = ANY (ARRAY['accepted'::text, 'dispatched'::text, 'acknowledged'::text, 'rejected'::text, 'failed'::text, 'timeout'::text]))),
    CONSTRAINT commands_ttl_s_check CHECK (((ttl_s >= 1) AND (ttl_s <= 60)))
);

ALTER TABLE ONLY public.commands FORCE ROW LEVEL SECURITY;


--
-- Name: devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.devices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    line_id uuid NOT NULL,
    name text NOT NULL
);

ALTER TABLE ONLY public.devices FORCE ROW LEVEL SECURITY;


--
-- Name: edge_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.edge_identities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    edge_id uuid NOT NULL,
    version integer NOT NULL,
    username text NOT NULL,
    fingerprint text,
    status text DEFAULT 'active'::text NOT NULL,
    secret_issued boolean DEFAULT true NOT NULL,
    grace_until timestamp with time zone,
    rotated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT edge_identities_status_check CHECK ((status = ANY (ARRAY['active'::text, 'grace'::text, 'disabled'::text, 'lost'::text])))
);

ALTER TABLE ONLY public.edge_identities FORCE ROW LEVEL SECURITY;


--
-- Name: edges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.edges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    site_id uuid NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    mqtt_username text,
    credential_version integer DEFAULT 0 NOT NULL,
    credential_fingerprint text,
    last_hb_at timestamp with time zone,
    clock_ok boolean,
    adapter text,
    buffer_depth integer,
    buffer_dropped bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT edges_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'disabled'::text])))
);

ALTER TABLE ONLY public.edges FORCE ROW LEVEL SECURITY;


--
-- Name: insights; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.insights (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    tag_id uuid NOT NULL,
    kind text,
    severity text,
    score real,
    state text DEFAULT 'open'::text NOT NULL,
    ts_start timestamp with time zone NOT NULL,
    ts_end timestamp with time zone,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT insights_kind_check CHECK ((kind = ANY (ARRAY['anomaly'::text, 'drift'::text, 'flatline'::text, 'flapping'::text]))),
    CONSTRAINT insights_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'warning'::text, 'critical'::text]))),
    CONSTRAINT insights_state_check CHECK ((state = ANY (ARRAY['open'::text, 'closed'::text])))
);

ALTER TABLE ONLY public.insights FORCE ROW LEVEL SECURITY;


--
-- Name: invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    email text NOT NULL,
    role text NOT NULL,
    token_hash text NOT NULL,
    invited_by uuid,
    expires_at timestamp with time zone NOT NULL,
    accepted_at timestamp with time zone,
    accepted_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT invites_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'operator'::text, 'viewer'::text])))
);

ALTER TABLE ONLY public.invites FORCE ROW LEVEL SECURITY;


--
-- Name: lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    site_id uuid NOT NULL,
    name text NOT NULL
);

ALTER TABLE ONLY public.lines FORCE ROW LEVEL SECURITY;


--
-- Name: memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memberships (
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT memberships_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text, 'viewer'::text])))
);

ALTER TABLE ONLY public.memberships FORCE ROW LEVEL SECURITY;


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    plan_limits jsonb DEFAULT '{"max_tags": 500, "max_edges": 10, "max_sites": 5}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT organizations_name_check CHECK (((length(name) >= 1) AND (length(name) <= 120)))
);

ALTER TABLE ONLY public.organizations FORCE ROW LEVEL SECURITY;


--
-- Name: revoked_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.revoked_sessions (
    sid text NOT NULL,
    revoked_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    timezone text DEFAULT 'UTC'::text NOT NULL,
    control_enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sites_code_check CHECK ((code ~ '^[a-z0-9][a-z0-9_-]{0,31}$'::text)),
    CONSTRAINT sites_name_check CHECK (((length(name) >= 1) AND (length(name) <= 120)))
);

ALTER TABLE ONLY public.sites FORCE ROW LEVEL SECURITY;


--
-- Name: tag_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tag_history (
    tag_id uuid NOT NULL,
    ts timestamp with time zone NOT NULL,
    org_id uuid NOT NULL,
    v jsonb NOT NULL,
    q text NOT NULL,
    CONSTRAINT tag_history_q_check CHECK ((q = ANY (ARRAY['good'::text, 'bad'::text, 'stale'::text, 'uncertain'::text])))
);

ALTER TABLE ONLY public.tag_history FORCE ROW LEVEL SECURITY;


--
-- Name: tag_latest; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tag_latest (
    tag_id uuid NOT NULL,
    org_id uuid NOT NULL,
    v jsonb NOT NULL,
    q text NOT NULL,
    ts timestamp with time zone NOT NULL,
    CONSTRAINT tag_latest_q_check CHECK ((q = ANY (ARRAY['good'::text, 'bad'::text, 'stale'::text, 'uncertain'::text])))
);

ALTER TABLE ONLY public.tag_latest FORCE ROW LEVEL SECURITY;


--
-- Name: tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    site_id uuid NOT NULL,
    edge_id uuid,
    device_id uuid,
    path text NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    unit text,
    writable boolean DEFAULT false NOT NULL,
    min_value double precision,
    max_value double precision,
    step_value double precision,
    enum_values jsonb,
    requires jsonb DEFAULT '[]'::jsonb NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tags_check CHECK (((min_value IS NULL) OR (max_value IS NULL) OR (min_value <= max_value))),
    CONSTRAINT tags_path_check CHECK ((path ~ '^[a-z0-9_]+(/[a-z0-9_]+){1,7}$'::text)),
    CONSTRAINT tags_type_check CHECK ((type = ANY (ARRAY['bool'::text, 'number'::text])))
);

ALTER TABLE ONLY public.tags FORCE ROW LEVEL SECURITY;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sub text NOT NULL,
    email text,
    email_verified boolean DEFAULT false NOT NULL,
    display_name text,
    locale text DEFAULT 'en'::text NOT NULL,
    disabled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT users_locale_check CHECK ((locale = ANY (ARRAY['en'::text, 'th'::text])))
);


--
-- Name: alarm_rules alarm_rules_org_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alarm_rules
    ADD CONSTRAINT alarm_rules_org_id_id_key UNIQUE (org_id, id);


--
-- Name: alarm_rules alarm_rules_org_id_tag_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alarm_rules
    ADD CONSTRAINT alarm_rules_org_id_tag_id_id_key UNIQUE (org_id, tag_id, id);


--
-- Name: alarm_rules alarm_rules_org_id_tag_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alarm_rules
    ADD CONSTRAINT alarm_rules_org_id_tag_id_name_key UNIQUE (org_id, tag_id, name);


--
-- Name: alarm_rules alarm_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alarm_rules
    ADD CONSTRAINT alarm_rules_pkey PRIMARY KEY (id);


--
-- Name: alarms alarms_org_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alarms
    ADD CONSTRAINT alarms_org_id_id_key UNIQUE (org_id, id);


--
-- Name: alarms alarms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alarms
    ADD CONSTRAINT alarms_pkey PRIMARY KEY (id);


--
-- Name: alembic_version alembic_version_pkc; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alembic_version
    ADD CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num);


--
-- Name: audit_log audit_log_org_id_seq_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_org_id_seq_key UNIQUE (org_id, seq);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: command_events command_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.command_events
    ADD CONSTRAINT command_events_pkey PRIMARY KEY (id);


--
-- Name: command_outbox command_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.command_outbox
    ADD CONSTRAINT command_outbox_pkey PRIMARY KEY (command_id);


--
-- Name: commands commands_org_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commands
    ADD CONSTRAINT commands_org_id_id_key UNIQUE (org_id, id);


--
-- Name: commands commands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commands
    ADD CONSTRAINT commands_pkey PRIMARY KEY (id);


--
-- Name: devices devices_org_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_org_id_id_key UNIQUE (org_id, id);


--
-- Name: devices devices_org_id_line_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_org_id_line_id_name_key UNIQUE (org_id, line_id, name);


--
-- Name: devices devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_pkey PRIMARY KEY (id);


--
-- Name: edge_identities edge_identities_org_id_edge_id_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.edge_identities
    ADD CONSTRAINT edge_identities_org_id_edge_id_version_key UNIQUE (org_id, edge_id, version);


--
-- Name: edge_identities edge_identities_org_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.edge_identities
    ADD CONSTRAINT edge_identities_org_id_id_key UNIQUE (org_id, id);


--
-- Name: edge_identities edge_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.edge_identities
    ADD CONSTRAINT edge_identities_pkey PRIMARY KEY (id);


--
-- Name: edge_identities edge_identities_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.edge_identities
    ADD CONSTRAINT edge_identities_username_key UNIQUE (username);


--
-- Name: edges edges_mqtt_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.edges
    ADD CONSTRAINT edges_mqtt_username_key UNIQUE (mqtt_username);


--
-- Name: edges edges_org_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.edges
    ADD CONSTRAINT edges_org_id_id_key UNIQUE (org_id, id);


--
-- Name: edges edges_org_id_site_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.edges
    ADD CONSTRAINT edges_org_id_site_id_id_key UNIQUE (org_id, site_id, id);


--
-- Name: edges edges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.edges
    ADD CONSTRAINT edges_pkey PRIMARY KEY (id);


--
-- Name: insights insights_org_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insights
    ADD CONSTRAINT insights_org_id_id_key UNIQUE (org_id, id);


--
-- Name: insights insights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insights
    ADD CONSTRAINT insights_pkey PRIMARY KEY (id);


--
-- Name: invites invites_org_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invites
    ADD CONSTRAINT invites_org_id_id_key UNIQUE (org_id, id);


--
-- Name: invites invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invites
    ADD CONSTRAINT invites_pkey PRIMARY KEY (id);


--
-- Name: invites invites_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invites
    ADD CONSTRAINT invites_token_hash_key UNIQUE (token_hash);


--
-- Name: lines lines_org_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lines
    ADD CONSTRAINT lines_org_id_id_key UNIQUE (org_id, id);


--
-- Name: lines lines_org_id_site_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lines
    ADD CONSTRAINT lines_org_id_site_id_name_key UNIQUE (org_id, site_id, name);


--
-- Name: lines lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lines
    ADD CONSTRAINT lines_pkey PRIMARY KEY (id);


--
-- Name: memberships memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_pkey PRIMARY KEY (org_id, user_id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: revoked_sessions revoked_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revoked_sessions
    ADD CONSTRAINT revoked_sessions_pkey PRIMARY KEY (sid);


--
-- Name: sites sites_org_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_org_id_code_key UNIQUE (org_id, code);


--
-- Name: sites sites_org_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_org_id_id_key UNIQUE (org_id, id);


--
-- Name: sites sites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_pkey PRIMARY KEY (id);


--
-- Name: tag_history tag_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_history
    ADD CONSTRAINT tag_history_pkey PRIMARY KEY (tag_id, ts);


--
-- Name: tag_latest tag_latest_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_latest
    ADD CONSTRAINT tag_latest_pkey PRIMARY KEY (tag_id);


--
-- Name: tags tags_org_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_org_id_id_key UNIQUE (org_id, id);


--
-- Name: tags tags_org_id_site_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_org_id_site_id_id_key UNIQUE (org_id, site_id, id);


--
-- Name: tags tags_org_id_site_id_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_org_id_site_id_path_key UNIQUE (org_id, site_id, path);


--
-- Name: tags tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_sub_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_sub_key UNIQUE (sub);


--
-- Name: alarms_one_open_per_rule; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX alarms_one_open_per_rule ON public.alarms USING btree (org_id, rule_id) WHERE (state = ANY (ARRAY['active'::text, 'acked'::text]));


--
-- Name: alarms_org_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX alarms_org_state ON public.alarms USING btree (org_id, state, raised_at DESC);


--
-- Name: audit_log_org_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_log_org_at ON public.audit_log USING btree (org_id, at DESC);


--
-- Name: command_events_cmd; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX command_events_cmd ON public.command_events USING btree (org_id, command_id, id);


--
-- Name: commands_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX commands_idempotency ON public.commands USING btree (org_id, actor_user_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: commands_one_inflight_per_tag; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX commands_one_inflight_per_tag ON public.commands USING btree (org_id, tag_id) WHERE (status = ANY (ARRAY['accepted'::text, 'dispatched'::text]));


--
-- Name: commands_org_issued; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX commands_org_issued ON public.commands USING btree (org_id, issued_at DESC);


--
-- Name: edge_identities_edge; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX edge_identities_edge ON public.edge_identities USING btree (org_id, edge_id, version DESC);


--
-- Name: insights_open_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX insights_open_uq ON public.insights USING btree (org_id, tag_id, kind) WHERE (state = 'open'::text);


--
-- Name: insights_org_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX insights_org_state ON public.insights USING btree (org_id, state, ts_start DESC);


--
-- Name: memberships_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX memberships_user ON public.memberships USING btree (user_id);


--
-- Name: tag_history_ts_brin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tag_history_ts_brin ON public.tag_history USING brin (ts);


--
-- Name: audit_log audit_log_chain; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_log_chain BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.audit_chain();


--
-- Name: audit_log audit_log_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_log_immutable BEFORE DELETE OR UPDATE ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.wds_reject_mutation();


--
-- Name: audit_log audit_log_no_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON public.audit_log FOR EACH STATEMENT EXECUTE FUNCTION public.wds_reject_mutation();


--
-- Name: command_events command_events_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER command_events_immutable BEFORE DELETE OR UPDATE ON public.command_events FOR EACH ROW EXECUTE FUNCTION public.wds_reject_mutation();


--
-- Name: command_events command_events_no_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER command_events_no_truncate BEFORE TRUNCATE ON public.command_events FOR EACH STATEMENT EXECUTE FUNCTION public.wds_reject_mutation();


--
-- Name: alarm_rules alarm_rules_org_id_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alarm_rules
    ADD CONSTRAINT alarm_rules_org_id_tag_id_fkey FOREIGN KEY (org_id, tag_id) REFERENCES public.tags(org_id, id) ON DELETE CASCADE;


--
-- Name: alarms alarms_acked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alarms
    ADD CONSTRAINT alarms_acked_by_fkey FOREIGN KEY (acked_by) REFERENCES public.users(id);


--
-- Name: alarms alarms_org_id_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alarms
    ADD CONSTRAINT alarms_org_id_tag_id_fkey FOREIGN KEY (org_id, tag_id) REFERENCES public.tags(org_id, id) ON DELETE CASCADE;


--
-- Name: alarms alarms_org_id_tag_id_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alarms
    ADD CONSTRAINT alarms_org_id_tag_id_rule_id_fkey FOREIGN KEY (org_id, tag_id, rule_id) REFERENCES public.alarm_rules(org_id, tag_id, id) ON DELETE CASCADE;


--
-- Name: audit_log audit_log_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: command_events command_events_org_id_command_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.command_events
    ADD CONSTRAINT command_events_org_id_command_id_fkey FOREIGN KEY (org_id, command_id) REFERENCES public.commands(org_id, id);


--
-- Name: command_outbox command_outbox_org_id_command_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.command_outbox
    ADD CONSTRAINT command_outbox_org_id_command_id_fkey FOREIGN KEY (org_id, command_id) REFERENCES public.commands(org_id, id) ON DELETE CASCADE;


--
-- Name: commands commands_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commands
    ADD CONSTRAINT commands_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: commands commands_org_id_site_id_edge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commands
    ADD CONSTRAINT commands_org_id_site_id_edge_id_fkey FOREIGN KEY (org_id, site_id, edge_id) REFERENCES public.edges(org_id, site_id, id);


--
-- Name: commands commands_org_id_site_id_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commands
    ADD CONSTRAINT commands_org_id_site_id_tag_id_fkey FOREIGN KEY (org_id, site_id, tag_id) REFERENCES public.tags(org_id, site_id, id);


--
-- Name: devices devices_org_id_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_org_id_line_id_fkey FOREIGN KEY (org_id, line_id) REFERENCES public.lines(org_id, id) ON DELETE CASCADE;


--
-- Name: edge_identities edge_identities_org_id_edge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.edge_identities
    ADD CONSTRAINT edge_identities_org_id_edge_id_fkey FOREIGN KEY (org_id, edge_id) REFERENCES public.edges(org_id, id) ON DELETE CASCADE;


--
-- Name: edges edges_org_id_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.edges
    ADD CONSTRAINT edges_org_id_site_id_fkey FOREIGN KEY (org_id, site_id) REFERENCES public.sites(org_id, id) ON DELETE CASCADE;


--
-- Name: insights insights_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insights
    ADD CONSTRAINT insights_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: insights insights_org_id_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insights
    ADD CONSTRAINT insights_org_id_tag_id_fkey FOREIGN KEY (org_id, tag_id) REFERENCES public.tags(org_id, id) ON DELETE CASCADE;


--
-- Name: invites invites_accepted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invites
    ADD CONSTRAINT invites_accepted_by_fkey FOREIGN KEY (accepted_by) REFERENCES public.users(id);


--
-- Name: invites invites_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invites
    ADD CONSTRAINT invites_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.users(id);


--
-- Name: invites invites_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invites
    ADD CONSTRAINT invites_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: lines lines_org_id_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lines
    ADD CONSTRAINT lines_org_id_site_id_fkey FOREIGN KEY (org_id, site_id) REFERENCES public.sites(org_id, id) ON DELETE CASCADE;


--
-- Name: memberships memberships_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: memberships memberships_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: sites sites_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: tag_history tag_history_org_id_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_history
    ADD CONSTRAINT tag_history_org_id_tag_id_fkey FOREIGN KEY (org_id, tag_id) REFERENCES public.tags(org_id, id) ON DELETE CASCADE;


--
-- Name: tag_latest tag_latest_org_id_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_latest
    ADD CONSTRAINT tag_latest_org_id_tag_id_fkey FOREIGN KEY (org_id, tag_id) REFERENCES public.tags(org_id, id) ON DELETE CASCADE;


--
-- Name: tags tags_org_id_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_org_id_device_id_fkey FOREIGN KEY (org_id, device_id) REFERENCES public.devices(org_id, id);


--
-- Name: tags tags_org_id_site_id_edge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_org_id_site_id_edge_id_fkey FOREIGN KEY (org_id, site_id, edge_id) REFERENCES public.edges(org_id, site_id, id);


--
-- Name: tags tags_org_id_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_org_id_site_id_fkey FOREIGN KEY (org_id, site_id) REFERENCES public.sites(org_id, id) ON DELETE CASCADE;


--
-- Name: alarm_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.alarm_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: alarms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.alarms ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: command_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.command_events ENABLE ROW LEVEL SECURITY;

--
-- Name: command_outbox; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.command_outbox ENABLE ROW LEVEL SECURITY;

--
-- Name: commands; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.commands ENABLE ROW LEVEL SECURITY;

--
-- Name: devices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;

--
-- Name: edge_identities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.edge_identities ENABLE ROW LEVEL SECURITY;

--
-- Name: edges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.edges ENABLE ROW LEVEL SECURITY;

--
-- Name: insights; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.insights ENABLE ROW LEVEL SECURITY;

--
-- Name: invites invite_by_token; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY invite_by_token ON public.invites FOR SELECT USING ((token_hash = public.wds_ctx_invite()));


--
-- Name: invites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

--
-- Name: lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lines ENABLE ROW LEVEL SECURITY;

--
-- Name: memberships member_self_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_self_read ON public.memberships FOR SELECT USING ((user_id = public.wds_ctx_user()));


--
-- Name: memberships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: organizations org_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_member_read ON public.organizations FOR SELECT USING ((id IN ( SELECT m.org_id
   FROM public.memberships m
  WHERE (m.user_id = public.wds_ctx_user()))));


--
-- Name: organizations org_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_self ON public.organizations USING ((id = public.wds_ctx_org())) WITH CHECK ((id = public.wds_ctx_org()));


--
-- Name: organizations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

--
-- Name: sites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;

--
-- Name: edge_identities system_edge_identity_lookup; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY system_edge_identity_lookup ON public.edge_identities FOR SELECT TO wds_system USING (true);


--
-- Name: edges system_edge_lookup; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY system_edge_lookup ON public.edges FOR SELECT TO wds_system USING (true);


--
-- Name: insights system_insights; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY system_insights ON public.insights TO wds_system USING (true) WITH CHECK (true);


--
-- Name: organizations system_org_list; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY system_org_list ON public.organizations FOR SELECT TO wds_system USING (true);


--
-- Name: tag_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tag_history ENABLE ROW LEVEL SECURITY;

--
-- Name: tag_latest; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tag_latest ENABLE ROW LEVEL SECURITY;

--
-- Name: tags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

--
-- Name: alarm_rules tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.alarm_rules USING ((org_id = public.wds_ctx_org())) WITH CHECK ((org_id = public.wds_ctx_org()));


--
-- Name: alarms tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.alarms USING ((org_id = public.wds_ctx_org())) WITH CHECK ((org_id = public.wds_ctx_org()));


--
-- Name: audit_log tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.audit_log USING ((org_id = public.wds_ctx_org())) WITH CHECK ((org_id = public.wds_ctx_org()));


--
-- Name: command_events tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.command_events USING ((org_id = public.wds_ctx_org())) WITH CHECK ((org_id = public.wds_ctx_org()));


--
-- Name: command_outbox tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.command_outbox USING ((org_id = public.wds_ctx_org())) WITH CHECK ((org_id = public.wds_ctx_org()));


--
-- Name: commands tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.commands USING ((org_id = public.wds_ctx_org())) WITH CHECK ((org_id = public.wds_ctx_org()));


--
-- Name: devices tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.devices USING ((org_id = public.wds_ctx_org())) WITH CHECK ((org_id = public.wds_ctx_org()));


--
-- Name: edge_identities tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.edge_identities USING ((org_id = public.wds_ctx_org())) WITH CHECK ((org_id = public.wds_ctx_org()));


--
-- Name: edges tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.edges USING ((org_id = public.wds_ctx_org())) WITH CHECK ((org_id = public.wds_ctx_org()));


--
-- Name: insights tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.insights USING ((org_id = public.wds_ctx_org())) WITH CHECK ((org_id = public.wds_ctx_org()));


--
-- Name: invites tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.invites USING ((org_id = public.wds_ctx_org())) WITH CHECK ((org_id = public.wds_ctx_org()));


--
-- Name: lines tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.lines USING ((org_id = public.wds_ctx_org())) WITH CHECK ((org_id = public.wds_ctx_org()));


--
-- Name: memberships tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.memberships USING ((org_id = public.wds_ctx_org())) WITH CHECK ((org_id = public.wds_ctx_org()));


--
-- Name: sites tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.sites USING ((org_id = public.wds_ctx_org())) WITH CHECK ((org_id = public.wds_ctx_org()));


--
-- Name: tag_history tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.tag_history USING ((org_id = public.wds_ctx_org())) WITH CHECK ((org_id = public.wds_ctx_org()));


--
-- Name: tag_latest tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.tag_latest USING ((org_id = public.wds_ctx_org())) WITH CHECK ((org_id = public.wds_ctx_org()));


--
-- Name: tags tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.tags USING ((org_id = public.wds_ctx_org())) WITH CHECK ((org_id = public.wds_ctx_org()));


--
-- PostgreSQL database dump complete
--

\unrestrict Jx2LaFdtRuef0vKKnmqSacIjqwQR8AvNahF3Qce2PFbfUgM2UytqOoPYow80HB7

