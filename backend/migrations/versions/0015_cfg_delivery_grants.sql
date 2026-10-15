-- 0015 - config delivery: wds_system (backend MQTT handlers) may read the
-- edge config counters, record the edge ack, and update data source status.
-- Applied by 0015_cfg_delivery_grants.py as wds_owner. DDL only.

GRANT SELECT (config_version, config_applied, config_error) ON edges TO wds_system;
GRANT UPDATE (config_applied, config_error) ON edges TO wds_system;

CREATE POLICY system_ds_status ON data_sources FOR UPDATE TO wds_system
  USING (true) WITH CHECK (true);
GRANT UPDATE (status, status_detail, status_at) ON data_sources TO wds_system;
