-- 0038 - system-side reads for exports/sweeps + the 30-day org purge
-- function (roadmap §12 8.3, §11 7.1).
--
-- The export_zip and org_purge workers run as wds_system inside a tenant
-- transaction (app.org_id set): tenant_isolation passes and these SELECT
-- grants open the tables the export covers. Reads are still RLS-scoped —
-- the grant widens columns/tables, never the org boundary.
-- Applied by 0038_purge_export_grants.py as wds_owner in one transaction.

-- NOTE: downtime_reasons is created later (0042) and grants wds_system there;
-- granting it here would abort the chain on a fresh database.
GRANT SELECT ON memberships, invites, audit_log, command_events,
               dashboards, notebooks, slos, slo_corrections,
               teams, team_members, incidents, incident_events,
               tag_history, users, commands,
               notification_channels, notification_deliveries,
               alarm_notify_state, insights
  TO wds_system;

-- per-org retention prune (plans.retention_prune) deletes history as
-- wds_system inside tenant_tx — the grant 0001 never issued.
GRANT DELETE ON tag_history TO wds_system;

-- ---------------------------------------------------------------------------
-- wds_purge_organization(org): the 30-day hard delete (roadmap §12 8.3).
--
-- Runs as the FUNCTION OWNER (wds_owner) so it can lift FORCE RLS and the
-- append-only triggers for exactly this delete — PDPA deletion must remove
-- audit history too.
--
-- FKs that would block the organizations cascade (NO ACTION / RESTRICT
-- referencing cascaded parents, or straight into organizations) get explicit
-- deletes first, in dependency order. Everything else cascades from the
-- organizations DELETE.
-- Callable ONLY by wds_system (the purge worker).
-- ---------------------------------------------------------------------------
CREATE FUNCTION wds_purge_organization(target uuid,
                                       force  boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  del timestamptz;
BEGIN
  IF target IS NULL THEN
    RAISE EXCEPTION 'purge target is null';
  END IF;
  -- FORCE RLS applies to wds_owner too: lift it before the existence check.
  ALTER TABLE organizations NO FORCE ROW LEVEL SECURITY;
  -- refuse to purge a live org: deleted_at must be set (soft delete), and the
  -- delete must be at least 30 days old — the restore window the caller also
  -- schedules against (config.ORG_PURGE_AFTER_DAYS). The guard lives HERE so a
  -- mistimed/manual call cannot wipe a restorable org; force=true is the
  -- documented escape hatch for support-driven immediate purges.
  SELECT deleted_at INTO del FROM organizations WHERE id = target;
  IF del IS NULL THEN
    ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
    RAISE EXCEPTION 'org % is not soft-deleted — refusing purge', target;
  END IF;
  IF NOT force AND del > now() - interval '30 days' THEN
    ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
    RAISE EXCEPTION 'org % soft-deleted less than 30 days ago — refusing purge (pass force=true to override)', target;
  END IF;

  -- append-only tables: immutable triggers off, RLS force off, delete, restore
  ALTER TABLE audit_log NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE audit_log DISABLE TRIGGER audit_log_immutable;
  DELETE FROM audit_log WHERE org_id = target;
  ALTER TABLE audit_log ENABLE TRIGGER audit_log_immutable;
  ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

  ALTER TABLE command_events NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE command_events DISABLE TRIGGER command_events_immutable;
  DELETE FROM command_events WHERE org_id = target;
  ALTER TABLE command_events ENABLE TRIGGER command_events_immutable;
  ALTER TABLE command_events FORCE ROW LEVEL SECURITY;

  -- rows that BLOCK the organizations cascade (NO ACTION / RESTRICT FKs into
  -- cascaded parents, or no cascade path at all)
  ALTER TABLE commands NO FORCE ROW LEVEL SECURITY;
  DELETE FROM commands WHERE org_id = target;
  ALTER TABLE commands FORCE ROW LEVEL SECURITY;

  ALTER TABLE insights NO FORCE ROW LEVEL SECURITY;
  DELETE FROM insights WHERE org_id = target;
  ALTER TABLE insights FORCE ROW LEVEL SECURITY;

  ALTER TABLE notification_deliveries NO FORCE ROW LEVEL SECURITY;
  DELETE FROM notification_deliveries WHERE org_id = target;
  ALTER TABLE notification_deliveries FORCE ROW LEVEL SECURITY;

  -- RESTRICT: versions die with vision_models; pins must go first
  ALTER TABLE camera_models NO FORCE ROW LEVEL SECURITY;
  DELETE FROM camera_models WHERE org_id = target;
  ALTER TABLE camera_models FORCE ROW LEVEL SECURITY;

  -- RESTRICT: data_sources die with sites; referencing tags must go first
  ALTER TABLE tags NO FORCE ROW LEVEL SECURITY;
  DELETE FROM tags WHERE org_id = target;
  ALTER TABLE tags FORCE ROW LEVEL SECURITY;

  -- no FK anywhere: would be orphaned rather than block — delete for PDPA
  ALTER TABLE alarm_notify_state NO FORCE ROW LEVEL SECURITY;
  DELETE FROM alarm_notify_state WHERE org_id = target;
  ALTER TABLE alarm_notify_state FORCE ROW LEVEL SECURITY;

  -- RESTRICT: cameras.video_id -> videos ON DELETE RESTRICT; videos die with
  -- the sites cascade, so the referencing cameras must go first or the
  -- organizations delete fails deterministically for orgs with cameras.
  ALTER TABLE cameras NO FORCE ROW LEVEL SECURITY;
  DELETE FROM cameras WHERE org_id = target;
  ALTER TABLE cameras FORCE ROW LEVEL SECURITY;

  DELETE FROM organizations WHERE id = target;
  ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
END $$;

REVOKE ALL ON FUNCTION wds_purge_organization(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wds_purge_organization(uuid, boolean) TO wds_system;
