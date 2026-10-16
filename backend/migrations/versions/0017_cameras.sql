-- 0017 - cameras and uploaded demo videos (spec 6.1).
-- Applied by 0017_cameras.py as wds_owner in one transaction.

CREATE TABLE videos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL,
  site_id      uuid NOT NULL,
  filename     text NOT NULL CHECK (length(filename) BETWEEN 1 AND 255),
  content_type text NOT NULL CHECK (content_type IN ('video/mp4', 'video/webm')),
  size_bytes   bigint NOT NULL CHECK (size_bytes > 0),
  sha256       text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_key  text NOT NULL,
  uploaded_by  uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, site_id) REFERENCES sites (org_id, id) ON DELETE CASCADE
);

CREATE TABLE cameras (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  site_id       uuid NOT NULL,
  edge_id       uuid NOT NULL,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  kind          text NOT NULL CHECK (kind IN ('rtsp', 'upload')),
  rtsp_url_enc  bytea,                         -- AES-GCM sealed; may hold credentials
  video_id      uuid,
  fps_sample    real NOT NULL DEFAULT 5 CHECK (fps_sample BETWEEN 0.5 AND 15),
  enabled       boolean NOT NULL DEFAULT true,
  status        text NOT NULL DEFAULT 'unknown' CHECK (status IN ('unknown', 'ok', 'error')),
  status_detail text,
  status_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, edge_id, name),
  CHECK ((kind = 'rtsp') = (rtsp_url_enc IS NOT NULL)),
  CHECK ((kind = 'upload') = (video_id IS NOT NULL)),
  FOREIGN KEY (org_id, site_id) REFERENCES sites (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, site_id, edge_id) REFERENCES edges (org_id, site_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, video_id) REFERENCES videos (org_id, id) ON DELETE RESTRICT
);
CREATE INDEX cameras_edge ON cameras (org_id, edge_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['videos', 'cameras'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = wds_ctx_org()) '
                   'WITH CHECK (org_id = wds_ctx_org())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO wds_app', t);
    EXECUTE format('CREATE POLICY system_lookup ON %I FOR SELECT TO wds_system USING (true)', t);
    EXECUTE format('GRANT SELECT ON %I TO wds_system', t);
  END LOOP;
END $$;

-- relay records camera health from the edge's stat messages
GRANT UPDATE (status, status_detail, status_at) ON cameras TO wds_system;
