-- 0052 - tag_history becomes a monthly range-partitioned table, with numeric
-- column `vn` and 1-minute / 1-hour rollup tables (spec 2026-10-19 §6, fallback
-- branch of the spike: TimescaleDB refuses compression AND continuous
-- aggregates on a table with row security, so the historian stays on native
-- Postgres where RLS works unchanged — see docs/adr/0002-historian-partitioning.md).
-- Applied by 0052_history_partitions.py as wds_owner in one transaction.

-- 1. move the old table aside (owner is subject to FORCE RLS with no tenant
--    context: lift it so the copy below can read every org's rows)
ALTER TABLE tag_history NO FORCE ROW LEVEL SECURITY;
ALTER TABLE tag_history RENAME TO tag_history_old;
ALTER INDEX tag_history_pkey RENAME TO tag_history_old_pkey;
ALTER INDEX tag_history_ts_brin RENAME TO tag_history_old_ts_brin;

-- 2. the partitioned parent. PK (tag_id, ts) already contains the partition
--    key, so QoS1 replay dedup (ON CONFLICT (tag_id, ts)) keeps working.
CREATE TABLE tag_history (
  tag_id uuid NOT NULL,
  ts     timestamptz NOT NULL,
  org_id uuid NOT NULL,
  v      jsonb NOT NULL,
  q      text NOT NULL CHECK (q IN ('good', 'bad', 'stale', 'uncertain')),
  vn     double precision,           -- numbers as-is, bool as 0/1, else NULL
  PRIMARY KEY (tag_id, ts),
  FOREIGN KEY (org_id, tag_id) REFERENCES tags (org_id, id) ON DELETE CASCADE
) PARTITION BY RANGE (ts);
CREATE INDEX tag_history_ts_brin ON tag_history USING brin (ts);
-- anything outside the pre-created months lands here instead of failing ingest
CREATE TABLE tag_history_default PARTITION OF tag_history DEFAULT;

-- 3. partition maintenance, callable by the app roles without giving them DDL.
--    Children carry no grants for the app roles, so they are reachable only
--    through the parent — whose RLS policy applies.
CREATE FUNCTION wds_history_ensure_partitions(p_from date, p_to date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d    date := date_trunc('month', p_from)::date;
  made integer := 0;
  nm   text;
  lo   timestamptz;
  hi   timestamptz;
BEGIN
  IF p_to - p_from > 3700 THEN
    RAISE EXCEPTION 'partition range too large';
  END IF;
  WHILE d <= p_to LOOP
    nm := format('tag_history_y%sm%s', to_char(d, 'YYYY'), to_char(d, 'MM'));
    IF to_regclass(format('public.%I', nm)) IS NULL THEN
      lo := d::timestamp AT TIME ZONE 'UTC';
      hi := (d + interval '1 month')::timestamp AT TIME ZONE 'UTC';
      -- Rows that already fell into the default partition would make the new
      -- partition's constraint check fail, so lift them out first and put them
      -- back into the child. Written to the child, not the parent: the child
      -- has no RLS (the owner has no tenant context) and its inherited FK is
      -- still enforced by the RI triggers. The lock keeps ingest from adding
      -- more to the default partition meanwhile.
      LOCK TABLE tag_history_default IN SHARE ROW EXCLUSIVE MODE;
      DROP TABLE IF EXISTS _hist_moved;
      CREATE TEMP TABLE _hist_moved ON COMMIT DROP AS
        WITH m AS (DELETE FROM tag_history_default
                    WHERE ts >= lo AND ts < hi RETURNING *)
        SELECT * FROM m;
      EXECUTE format('CREATE TABLE %I PARTITION OF tag_history'
                     ' FOR VALUES FROM (%L) TO (%L)', nm, lo, hi);
      EXECUTE format('INSERT INTO %I SELECT * FROM _hist_moved', nm);
      made := made + 1;
    END IF;
    d := (d + interval '1 month')::date;
  END LOOP;
  RETURN made;
END $$;

-- drop whole months that ended before p_cutoff (the longest plan retention)
CREATE FUNCTION wds_history_drop_before(p_cutoff timestamptz)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r       record;
  dropped integer := 0;
BEGIN
  FOR r IN
    SELECT c.relname AS nm,
           to_date(substring(c.relname FROM 'y(\d{4}m\d{2})$'), 'YYYY"m"MM') AS m
      FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
     WHERE i.inhparent = 'public.tag_history'::regclass
       AND c.relname ~ '^tag_history_y\d{4}m\d{2}$'
  LOOP
    IF ((r.m + interval '1 month')::timestamp AT TIME ZONE 'UTC') <= p_cutoff THEN
      EXECUTE format('DROP TABLE %I', r.nm);
      dropped := dropped + 1;
    END IF;
  END LOOP;
  RETURN dropped;
END $$;

REVOKE ALL ON FUNCTION wds_history_ensure_partitions(date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION wds_history_drop_before(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wds_history_ensure_partitions(date, date) TO wds_app, wds_system;
GRANT EXECUTE ON FUNCTION wds_history_drop_before(timestamptz) TO wds_system;

-- 4. months from the oldest existing row to three months ahead, then copy
SELECT wds_history_ensure_partitions(
  COALESCE((SELECT min(ts) FROM tag_history_old)::date, now()::date),
  (now() + interval '3 months')::date);

INSERT INTO tag_history (tag_id, ts, org_id, v, q, vn)
SELECT tag_id, ts, org_id, v, q,
       CASE jsonb_typeof(v)
         WHEN 'number'  THEN (v #>> '{}')::float8
         WHEN 'boolean' THEN CASE WHEN v = 'true'::jsonb THEN 1 ELSE 0 END
       END
  FROM tag_history_old;
DROP TABLE tag_history_old;

-- 5. RLS + grants exactly as the old table had them (0001, 0038)
ALTER TABLE tag_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tag_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tag_history
  USING (org_id = wds_ctx_org()) WITH CHECK (org_id = wds_ctx_org());
GRANT SELECT, INSERT ON tag_history TO wds_app;
GRANT SELECT, INSERT, DELETE ON tag_history TO wds_system;

-- 6. rollups: ordinary tables, so ordinary RLS. wds_system (the refresh job)
--    writes them inside a tenant tx; wds_app only reads.
--    avg = sm / nn ; n counts every sample, nn only the numeric ones.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tag_rollup_1m', 'tag_rollup_1h'] LOOP
    EXECUTE format($f$
      CREATE TABLE %I (
        org_id uuid NOT NULL,
        tag_id uuid NOT NULL,
        bucket timestamptz NOT NULL,
        mn     double precision,
        mx     double precision,
        sm     double precision,
        nn     integer NOT NULL DEFAULT 0,
        n      integer NOT NULL,
        lv     double precision,
        lts    timestamptz,
        PRIMARY KEY (tag_id, bucket),
        FOREIGN KEY (org_id, tag_id) REFERENCES tags (org_id, id) ON DELETE CASCADE
      )$f$, t);
    EXECUTE format('CREATE INDEX %I ON %I (bucket)', t || '_bucket', t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = wds_ctx_org()) '
                   'WITH CHECK (org_id = wds_ctx_org())', t);
    EXECUTE format('GRANT SELECT ON %I TO wds_app', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO wds_system', t);
  END LOOP;
END $$;
