-- 0048 - plant parts: per-part motion parameters + two more kinds.
-- `params` holds only what the browser needs to animate a part (axis, travel,
-- rpm, flow direction); the API whitelists the keys per kind. Applied by
-- 0048_plant_part_params.py as wds_owner in one transaction.

ALTER TABLE plant_parts ADD COLUMN params jsonb NOT NULL DEFAULT '{}';
ALTER TABLE plant_parts ADD CONSTRAINT plant_parts_params_small
  CHECK (pg_column_size(params) <= 2048);

ALTER TABLE plant_parts DROP CONSTRAINT plant_parts_kind_check;
ALTER TABLE plant_parts ADD CONSTRAINT plant_parts_kind_check CHECK (kind IN
  ('motor', 'conveyor', 'vessel', 'valve', 'pump', 'mixer', 'indicator', 'pipe', 'slider'));
