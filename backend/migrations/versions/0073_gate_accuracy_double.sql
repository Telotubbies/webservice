-- 0073 - gate_min_accuracy was float4 (0.9 read back as 0.8999999762); store it as double precision.
ALTER TABLE vision_models ALTER COLUMN gate_min_accuracy TYPE double precision;
