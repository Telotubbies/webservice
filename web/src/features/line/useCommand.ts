// Send a guarded command and follow its lifecycle (WS streams updates; REST
// polling is the fallback while the command is in flight).

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError, type ConflictBody } from '../../lib/api';
import { live } from '../../lib/live';
import { useStore } from '../../lib/hooks';
import type { Command } from '../../types';

/** api.postCommand's body type predates reason / dry_run (api.ts is not F05's file). */
type Body = Parameters<typeof api.postCommand>[0] & { reason?: string; dry_run?: boolean };

export interface DryCheck { id: string; ok: boolean; blocking: boolean; error: string | null; [k: string]: unknown }
export interface DryRun { dry_run: true; ok: boolean; sent: false; checks: DryCheck[] }

const TERMINAL = new Set(['done', 'denied', 'failed', 'timeout', 'unknown', 'acknowledged', 'rejected']);

export function isTerminal(status: string | undefined): boolean {
  return status !== undefined && TERMINAL.has(status);
}

/** Post a command, map send errors to copy, and track it to a terminal
 *  state (WS updates, REST poll as fallback). */
export function useCommand() {
  const { t, i18n } = useTranslation();
  const [trackedId, setTrackedId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useStore(() => live.cmdRev);
  const tracked: Command | undefined = trackedId ? live.commands.get(trackedId) : undefined;

  useEffect(() => {
    if (!trackedId || isTerminal(tracked?.status)) return;
    const id = setInterval(async () => {
      try { live.mergeCommand(await api.getCommand(trackedId)); } catch { /* backend restarting */ }
    }, 2000);
    return () => clearInterval(id);
  }, [trackedId, tracked?.status]);

  const send = useCallback(async (tag: string, value: number | boolean, reason?: string) => {
    setError('');
    setBusy(true);
    try {
      const body: Body = { tag, value, reason, ttl_s: 15, idempotency_key: crypto.randomUUID() };
      const res = await api.postCommand(body);
      const now = new Date().toISOString();
      live.mergeCommand({ id: res.command_id, tag, value, status: 'issued', created_at: now, updated_at: now, note: reason } as Command);
      setTrackedId(res.command_id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && (e.body as { detail?: string } | undefined)?.detail !== 'permissive_not_met') {
        setError(t('control.inFlight'));
        const active = (e.body as ConflictBody)?.active_command_id;
        if (active) setTrackedId(active);
      } else if (e instanceof ApiError && e.status === 429) {
        setError(t('errors.rateLimited'));
      } else if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        setError(t('control.authFailed', { status: e.status }));
      } else if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        const b = e.body as { detail?: string; min?: number; max?: number; tag?: string; why?: string } | undefined;
        const key = `f05.e_${b?.detail ?? ''}`;
        setError(b?.detail && i18n.exists(key) ? t(key, { min: b.min, max: b.max, tag: b.tag, why: t(`f05.why_${b.why}`, { defaultValue: b.why ?? '' }) }) : t('control.failed', { reason: e.message }));
      } else {
        setError(t('control.failed', { reason: e instanceof Error ? e.message : '?' }));
      }
    } finally {
      setBusy(false);
    }
  }, [t, i18n]);

  /** Run every server gate without sending anything. Throws ApiError on transport/auth errors. */
  const dryRun = useCallback(async (tag: string, value: number | boolean, reason: string): Promise<DryRun> => {
    const body: Body = { tag, value, reason, dry_run: true };
    return (await api.postCommand(body)) as unknown as DryRun;
  }, []);

  return { send, dryRun, tracked, error, busy, clearError: () => setError('') };
}
