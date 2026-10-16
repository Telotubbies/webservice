-- 0023 - vision detection events + reviewer verdicts (roadmap 9.8, 9.11).
-- Events arrive over the edge's own vision/event topic and are written by the
-- ingest worker (wds_system inside tenant_tx); thumbs stay <= 128 KB.
-- Applied by 0023_vision_events.py as wds_owner in one transaction.

CREATE TABLE vision_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL,
  camera_id        uuid NOT NULL,
  rule_id          uuid,                                -- NULL for alert_object rows
  kind             text NOT NULL CHECK (kind IN
                     ('rule_fire', 'blocked', 'dry_run', 'alert_object')),
  class_id         integer CHECK (class_id IS NULL OR class_id >= 0),
  score            real CHECK (score IS NULL OR score BETWEEN 0 AND 1),
  bbox             jsonb,                               -- [x,y,w,h] normalized
  model_version_id uuid,
  thumb            bytea CHECK (thumb IS NULL OR octet_length(thumb) <= 131072),
  severity         text CHECK (severity IS NULL OR severity IN ('info', 'warning', 'critical')),
  blocked_reason   text CHECK (blocked_reason IS NULL OR length(blocked_reason) <= 200),
  detail           jsonb,                               -- action outcomes, counters, etc.
  fired_at         timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, camera_id) REFERENCES cameras (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, rule_id) REFERENCES vision_rules (org_id, id) ON DELETE SET NULL,
  FOREIGN KEY (org_id, model_version_id) REFERENCES vision_model_versions (org_id, id)
    ON DELETE SET NULL
);
CREATE INDEX vision_events_camera_time ON vision_events (org_id, camera_id, fired_at DESC);
CREATE INDEX vision_events_org_time ON vision_events (org_id, fired_at DESC);
CREATE INDEX vision_events_rule ON vision_events (org_id, rule_id);
-- ingest dedup (MQTT QoS1 replay / edge retry): the natural event key is
-- (camera, rule, fired_at). Compatible with
-- ON CONFLICT (org_id, camera_id, rule_id, fired_at) DO NOTHING; NULL rule_id
-- (alert_object rows) never conflicts, matching standard unique semantics.
CREATE UNIQUE INDEX vision_events_dedup
  ON vision_events (org_id, camera_id, rule_id, fired_at);

CREATE TABLE vision_event_reviews (
  event_id           uuid PRIMARY KEY,
  org_id             uuid NOT NULL,
  verdict            text NOT NULL CHECK (verdict IN ('correct', 'wrong')),
  corrected_class_id integer CHECK (corrected_class_id IS NULL OR corrected_class_id >= 0),
  reviewed_by        uuid REFERENCES users (id),
  reviewed_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, event_id),
  FOREIGN KEY (org_id, event_id) REFERENCES vision_events (org_id, id) ON DELETE CASCADE
);
CREATE INDEX vision_event_reviews_org ON vision_event_reviews (org_id, verdict);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['vision_events', 'vision_event_reviews'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = wds_ctx_org()) '
                   'WITH CHECK (org_id = wds_ctx_org())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO wds_app', t);
    EXECUTE format('CREATE POLICY system_lookup ON %I FOR SELECT TO wds_system USING (true)', t);
  END LOOP;
END $$;

-- ingest (wds_system) stores events from the edge's vision/event topic
GRANT SELECT, INSERT ON vision_events TO wds_system;
GRANT SELECT ON vision_event_reviews TO wds_system;
