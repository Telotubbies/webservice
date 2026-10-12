// Send a guarded command and follow its lifecycle (WS streams updates; REST
// polling is the fallback while the command is in flight).

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError, type ConflictBody } from '../../lib/api';
import { live } from '../../lib/live';
import { useStore } from '../../lib/hooks';
import type { Command } from '../../types';

const TERMINAL = new Set(['done', 'denied', 'failed', 'timeout', 'acknowledged', 'rejected']);

export function isTerminal(status: string | undefined): boolean {
  return status !== undefined && TERMINAL.has(status);
}

export function useCommand() {
  const { t } = useTranslation();
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

  const send = useCallback(async (tag: string, value: number | boolean) => {
    setError('');
    setBusy(true);
    try {
      const res = await api.postCommand({ tag, value, ttl_s: 15, idempotency_key: crypto.randomUUID() });
      const now = new Date().toISOString();
      live.mergeCommand({ id: res.command_id, tag, value, status: 'issued', created_at: now, updated_at: now });
      setTrackedId(res.command_id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError(t('control.inFlight'));
        const active = (e.body as ConflictBody)?.active_command_id;
        if (active) setTrackedId(active);
      } else if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        setError(t('control.authFailed', { status: e.status }));
      } else {
        setError(t('control.failed', { reason: e instanceof Error ? e.message : '?' }));
      }
    } finally {
      setBusy(false);
    }
  }, [t]);

  return { send, tracked, error, busy, clearError: () => setError('') };
}
