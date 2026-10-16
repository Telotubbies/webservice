-- 0019 - remember the class count an export declared, so pasted names can be checked against it.
ALTER TABLE vision_model_versions ADD COLUMN class_count integer;
GRANT UPDATE (class_count) ON vision_model_versions TO wds_system;
