-- 0049 - material (gravel/sand) decision per camera + AI inference metrics.
-- cameras.material: NULL = decision off; otherwise the validated settings
-- object (thresholds, preprocessing, PLC outputs) that rides the edge cfg.
-- vision_metrics: one row per camera per stat period (~10 s) written by the
-- ingest worker; 7-day retention is enforced by the writer. Applied by
-- 0049_material_decision.py as wds_owner in one transaction.

ALTER TABLE cameras ADD COLUMN material jsonb;
ALTER TABLE cameras ADD CONSTRAINT cameras_material_small
  CHECK (material IS NULL OR pg_column_size(material) <= 8192);

ALTER TABLE vision_events DROP CONSTRAINT vision_events_kind_check;
ALTER TABLE vision_events ADD CONSTRAINT vision_events_kind_check CHECK (kind IN
  ('rule_fire', 'blocked', 'dry_run', 'alert_object', 'material'));

CREATE TABLE vision_metrics (
  org_id      uuid NOT NULL,
  camera_id   uuid NOT NULL,
  ts          timestamptz NOT NULL DEFAULT now(),
  fps         real CHECK (fps IS NULL OR fps >= 0),
  latency_ms  real CHECK (latency_ms IS NULL OR latency_ms >= 0),
  infer_n     integer CHECK (infer_n IS NULL OR infer_n >= 0),   -- inferences this period
  det_n       integer CHECK (det_n IS NULL OR det_n >= 0),       -- detections this period
  gate        text CHECK (gate IS NULL OR gate IN ('empty', 'present')),
  sand_frac   real CHECK (sand_frac IS NULL OR sand_frac BETWEEN 0 AND 1),
  coverage    real CHECK (coverage IS NULL OR coverage BETWEEN 0 AND 1),
  PRIMARY KEY (org_id, camera_id, ts),
  FOREIGN KEY (org_id, camera_id) REFERENCES cameras (org_id, id) ON DELETE CASCADE
);
CREATE INDEX vision_metrics_time ON vision_metrics (org_id, ts DESC);

ALTER TABLE vision_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE vision_metrics FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON vision_metrics USING (org_id = wds_ctx_org())
  WITH CHECK (org_id = wds_ctx_org());
GRANT SELECT ON vision_metrics TO wds_app;
CREATE POLICY system_lookup ON vision_metrics FOR SELECT TO wds_system USING (true);
GRANT SELECT, INSERT, DELETE ON vision_metrics TO wds_system;
