-- 0056 - auditable control commands (F05).
--   * status gains 'unknown': the edge wrote the value but could not read it
--     back, so the outcome is not confirmed. It is terminal and never success.
--   * every NEW command must carry a non-blank operator reason (commands.note).
--     NOT VALID: rows written before this migration get a 'legacy' marker, the
--     check applies to every insert/update from now on (DB-level backstop to
--     the check CommandManager.issue runs).
-- Applied by 0056_auditable_commands.py as wds_owner in one transaction.

ALTER TABLE commands DROP CONSTRAINT commands_status_check;
ALTER TABLE commands ADD CONSTRAINT commands_status_check
  CHECK (status IN ('accepted', 'dispatched', 'acknowledged', 'rejected',
                    'failed', 'unknown', 'timeout'));

-- A legacy row must still be updatable (the restart sweeper moves in-flight
-- rows), so rows without a reason get an explicit marker, not a made-up one.
ALTER TABLE commands NO FORCE ROW LEVEL SECURITY;
UPDATE commands SET note = 'legacy: no reason recorded'
  WHERE note IS NULL OR btrim(note) = '';
ALTER TABLE commands FORCE ROW LEVEL SECURITY;

ALTER TABLE commands ADD CONSTRAINT commands_note_required
  CHECK (note IS NOT NULL AND length(btrim(note)) > 0) NOT VALID;
