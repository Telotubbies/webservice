-- 0011 — trend-aware alarm rule kinds. `roc` (absolute change over window_s),
-- `anomaly` (z-score vs the trailing window_s baseline), `forecast` (linear
-- projection window_s ahead, fitted on the last window_s). All three reuse
-- `threshold` (delta / sigma / projected value) and `deadband` for the clear.

ALTER TABLE alarm_rules ADD COLUMN window_s integer
  CHECK (window_s IS NULL OR window_s BETWEEN 30 AND 86400);

ALTER TABLE alarm_rules DROP CONSTRAINT alarm_rules_kind_check;
ALTER TABLE alarm_rules ADD CONSTRAINT alarm_rules_kind_check
  CHECK (kind IN ('hi', 'hihi', 'lo', 'lolo', 'stale', 'roc', 'anomaly', 'forecast'));

DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'alarm_rules'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%stale_s IS NOT NULL%';
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE alarm_rules DROP CONSTRAINT %I', c); END IF;
END $$;

ALTER TABLE alarm_rules ADD CONSTRAINT alarm_rules_shape_check CHECK (
  (kind = 'stale' AND stale_s IS NOT NULL)
  OR (kind IN ('roc', 'anomaly', 'forecast') AND threshold IS NOT NULL AND window_s IS NOT NULL)
  OR (kind IN ('hi', 'hihi', 'lo', 'lolo') AND threshold IS NOT NULL));
