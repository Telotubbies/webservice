-- 0065 - per-plan ingest budget (F14): samples per minute one org may push.
-- NULL means the platform default (INGEST_ORG_RATE_PER_MIN).
ALTER TABLE plans ADD COLUMN ingest_msgs_per_min integer CHECK (ingest_msgs_per_min IS NULL OR ingest_msgs_per_min >= 1);
