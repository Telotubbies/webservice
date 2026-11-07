-- 0059 - my work (F08): no new table. The inbox reads unreviewed truck
-- decisions (vision_events kind='material') per org; this partial index keeps
-- that read cheap as events pile up. RLS is unchanged (vision_events already
-- isolates by org). Applied by 0059_my_work.py as wds_owner in one transaction.

CREATE INDEX IF NOT EXISTS vision_events_material_time
  ON vision_events (org_id, fired_at DESC) WHERE kind = 'material';
