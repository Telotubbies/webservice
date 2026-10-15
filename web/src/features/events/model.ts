// Unified event stream (Events explorer, /activity timeline, incident
// timelines). Every row is derived from a real record:
//   alarm   — alarm history (v2 times joined to v1 names, see alarmHistory.ts)
//   insight — /api/insights (all states, server cap 200) merged with live WS
//   command — operator+ only: live store + /api/commands seed. Viewers never
//             fetch it (zero-4xx rule) and never see command rows.
//   system  — health / sign-in entries from the session journal. These exist
//             only since this tab opened, so rows carry `session: true`.
// Alarm/insight/command journal entries are NOT re-used — the records above
// already cover them, and double rows would inflate counts.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { live } from '../../lib/live';
import { useStore } from '../../lib/hooks';
import { equipmentOf, type EquipmentId } from '../../lib/plant';
import { canOperate, useRole } from '../../app/session';
import { normSeverity, type Severity } from '../../shared/ui/Status';
import { useAlarmHistory } from './alarmHistory';
import type { Alarm, Command, Insight } from '../../types';

export type EventSource = 'alarm' | 'insight' | 'command' | 'system';
export type EventAction =
  | 'raised' | 'acked' | 'cleared'
  | 'opened' | 'closed'
  | 'issued' | 'done' | 'failed'
  | 'edgeDown' | 'edgeUp' | 'session';

export const SOURCES: readonly EventSource[] = ['alarm', 'insight', 'command', 'system'];

export interface PlantEvent {
  id: string;
  at: number;              // epoch ms of the transition
  source: EventSource;
  action: EventAction;
  /** null = not an abnormal condition (acks, clears, finished commands) */
  severity: Severity | null;
  /** literal subject: rule name, insight kind, command value */
  subject: string;
  tag?: string;
  equipment?: EquipmentId;
  actor?: string;
  href?: string;
  /** source record id (alarm id / insight id / command id) */
  ref?: string;
  /** exists only in this browser session (journal-derived) */
  session?: boolean;
}

const CMD_FAILED = new Set(['failed', 'denied', 'timeout', 'rejected', 'expired']);
const CMD_DONE = new Set(['done', 'acknowledged', 'succeeded']);

const ms = (iso?: string | null) => (iso ? Date.parse(iso) || 0 : 0);

function trendsHref(tag: string, from: number, to: number): string {
  const pad = 10 * 60_000;
  return `/trends?tags=${encodeURIComponent(tag)}&from=${Math.round(from - pad)}&to=${Math.round(to + pad)}`;
}

export function alarmEvents(a: Alarm): PlantEvent[] {
  const base = {
    source: 'alarm' as const, subject: a.rule, tag: a.tag, equipment: equipmentOf(a.tag),
    href: `/alarms/${encodeURIComponent(String(a.id))}`, ref: String(a.id),
  };
  const out: PlantEvent[] = [];
  const raised = ms(a.ts);
  if (raised) out.push({ ...base, id: `a:${a.id}:r`, at: raised, action: 'raised', severity: normSeverity(a.severity) });
  const acked = ms(a.acked_at);
  if (acked) out.push({ ...base, id: `a:${a.id}:a`, at: acked, action: 'acked', severity: null, actor: a.acked_by ?? undefined });
  const cleared = ms(a.cleared_at);
  if (cleared) out.push({ ...base, id: `a:${a.id}:c`, at: cleared, action: 'cleared', severity: null });
  return out;
}

export function insightEvents(i: Insight): PlantEvent[] {
  const start = ms(i.ts_start);
  const end = ms(i.ts_end);
  const base = {
    source: 'insight' as const, subject: i.kind, tag: i.tag, equipment: equipmentOf(i.tag),
    href: trendsHref(i.tag, start || Date.now(), end || Date.now()), ref: i.id,
  };
  const out: PlantEvent[] = [];
  if (start) out.push({ ...base, id: `i:${i.id}:o`, at: start, action: 'opened', severity: normSeverity(i.severity) });
  if (end && i.state === 'closed') out.push({ ...base, id: `i:${i.id}:c`, at: end, action: 'closed', severity: null });
  return out;
}

export function commandEvents(c: Command): PlantEvent[] {
  const base = {
    source: 'command' as const,
    subject: c.value === undefined ? '' : String(c.value),
    tag: c.tag, equipment: equipmentOf(c.tag), actor: c.user,
    href: `/commands?cmd=${encodeURIComponent(c.id)}`, ref: c.id,
  };
  const out: PlantEvent[] = [];
  const issued = ms(c.created_at);
  if (issued) out.push({ ...base, id: `c:${c.id}:i`, at: issued, action: 'issued', severity: null });
  const end = ms(c.updated_at);
  const status = String(c.status);
  if (end && (CMD_DONE.has(status) || CMD_FAILED.has(status))) {
    const failed = CMD_FAILED.has(status);
    out.push({
      ...base, id: `c:${c.id}:e`, at: end, action: failed ? 'failed' : 'done',
      severity: failed ? 'warning' : null, subject: status,
    });
  }
  return out;
}

function journalEvents(): PlantEvent[] {
  const out: PlantEvent[] = [];
  for (const j of live.journal) {
    if (j.kind !== 'health' && j.kind !== 'auth') continue;
    const action: EventAction = j.kind === 'auth' ? 'session'
      : j.title === 'notify.edgeUp' ? 'edgeUp' : 'edgeDown';
    out.push({
      id: `j:${j.id}`, at: ms(j.ts), source: 'system', action,
      severity: action === 'edgeDown' ? 'warning' : null,
      subject: '', href: j.href, session: true,
    });
  }
  return out;
}

export interface EventStream {
  events: PlantEvent[];           // newest first
  /** command rows are included (operator+) */
  commandsVisible: boolean;
  /** v2 alarm times loaded — ack/clear rows are complete */
  alarmTimesKnown: boolean;
  loading: boolean;
  error: boolean;
  retry: () => void;
}

/** All events from every source, newest first. Mount once per page. */
export function useEventStream(): EventStream {
  const operable = canOperate(useRole());
  const insightRev = useStore(() => live.insightRev);
  const cmdRev = useStore(() => live.cmdRev);
  const journalRev = useStore(() => live.journalRev);
  const history = useAlarmHistory();

  const insightsQ = useQuery({
    queryKey: ['events-insights'],
    queryFn: () => api.insights(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  // operator-only endpoint: `enabled` keeps viewers from ever requesting it
  const commandsQ = useQuery({
    queryKey: ['events-commands'],
    queryFn: () => api.listCommands(100),
    enabled: operable,
    staleTime: 30_000,
  });

  const insightRows = useMemo(() => {
    const m = new Map<string, Insight>();
    for (const i of insightsQ.data ?? []) m.set(i.id, i);
    for (const i of live.insights) m.set(i.id, { ...m.get(i.id), ...i });
    return [...m.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insightsQ.data, insightRev]);

  const commandRows = useMemo(() => {
    if (!operable) return [];
    const m = new Map<string, Command>();
    for (const c of commandsQ.data ?? []) m.set(c.id, c);
    for (const c of live.commands.values()) m.set(c.id, { ...m.get(c.id), ...c });
    return [...m.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operable, commandsQ.data, cmdRev]);

  const events = useMemo(() => {
    const out: PlantEvent[] = [];
    for (const a of history.alarms) out.push(...alarmEvents(a));
    for (const i of insightRows) out.push(...insightEvents(i));
    for (const c of commandRows) out.push(...commandEvents(c));
    out.push(...journalEvents());
    return out.filter((e) => e.at > 0).sort((a, b) => b.at - a.at);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.alarms, insightRows, commandRows, journalRev]);

  return {
    events,
    commandsVisible: operable,
    alarmTimesKnown: history.timesKnown,
    loading: (history.loading && !live.alarmsSeeded) || insightsQ.isLoading,
    error: insightsQ.isError && history.error,
    retry: () => { history.refetch(); void insightsQ.refetch(); if (operable) void commandsQ.refetch(); },
  };
}

/** i18n key for the row title — `{{subject}}` interpolates the literal. */
export function eventTitleKey(e: PlantEvent): string {
  return `evx.a.${e.source}.${e.action}`;
}

/** Fields for the omnibar grammar (lib/query.ts). */
export function eventFields(e: PlantEvent, label: (tag: string) => string) {
  return {
    source: e.source,
    action: e.action,
    sev: e.severity ?? 'none',
    severity: e.severity ?? 'none',
    tag: e.tag ? [e.tag, label(e.tag)] : undefined,
    eq: e.equipment,
    rule: e.source === 'alarm' ? e.subject : undefined,
    kind: e.source === 'insight' ? e.subject : undefined,
    by: e.actor,
    text: e.subject,
  };
}
