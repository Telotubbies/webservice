// Pure model of the console-v6 line page (D2): the live store becomes
// equipment rows, the last command on each one, its alarm, and the feed
// state. No React and no i18n — labels, units and number formatting stay in
// the view so this logic is testable without a DOM.

import type { Alarm, AlarmRule, Command, Quality, TagValue } from '../../types';
import type { RunState } from '../../shared/ui/Status';
import { STALE_MS } from '../../lib/live';
import { T } from '../../lib/plant';

export interface EqMeta { id: string; labelKey: string; signals: string[] }
export type CommandKindOfRow = 'run' | 'set' | 'other';
export interface RowLimits { lo?: number; hi?: number }

/** The command type each writable signal takes — keyed by tag, not equipment,
 *  because the newest command on an equipment may be on any of its signals. */
export const COMMAND_KINDS: Record<string, CommandKindOfRow> = { [T.running]: 'run', [T.speedSp]: 'set' };

export interface EquipmentRow {
  id: string;
  seq: number;
  labelKey: string;
  signals: string[];
  /** the signal the row reads and the inspector shows */
  tag: string;
  value: number | boolean | null;
  /** true when this equipment owns the line's run signal */
  hasRunSignal: boolean;
  /** the numeric reading a readout can show, or null when there is none */
  reading: number | null;
  limits: RowLimits;
  command?: { code: string; at: string };
  state: RunState;
  alarm?: 'critical' | 'warning';
  quality?: Quality;
  stale: boolean;
  ts?: string;
}

/** Tightest enabled lo and hi thresholds configured for one tag. */
export function rowLimits(rules: AlarmRule[], tag: string): RowLimits {
  let lo: number | undefined;
  let hi: number | undefined;
  for (const r of rules) {
    if (!r.enabled || r.tag !== tag || r.threshold == null) continue;
    if (r.kind === 'lo' || r.kind === 'lolo') lo = lo == null ? r.threshold : Math.max(lo, r.threshold);
    if (r.kind === 'hi' || r.kind === 'hihi') hi = hi == null ? r.threshold : Math.min(hi, r.threshold);
  }
  return { lo, hi };
}

/** A reading older than STALE_MS, missing, or of bad/stale quality. */
export function staleOf(tv: TagValue | undefined, now: number): boolean {
  return !tv || !(now - Date.parse(tv.ts) <= STALE_MS) || tv.q === 'stale' || tv.q === 'bad';
}

export function commandCode(kind: CommandKindOfRow, value: number | boolean | undefined): string {
  if (kind === 'run') return value ? 'START' : 'STOP';
  return kind === 'set' ? 'SET' : 'OTHER';
}

/** Newest command that touched one of `tags`, by updated_at then created_at. */
export function newestCommand(commands: Iterable<Command>, tags: Set<string>): Command | undefined {
  let best: Command | undefined;
  let bestAt = -Infinity;
  for (const c of commands) {
    if (!tags.has(c.tag)) continue;
    const at = Date.parse(c.updated_at ?? c.created_at ?? '');
    if (!Number.isFinite(at) || at <= bestAt) continue;
    best = c;
    bestAt = at;
  }
  return best;
}

export function rowState(stale: boolean, running: boolean): RunState {
  return stale ? 'stale' : running ? 'running' : 'stopped';
}

/** Worst open alarm on the given signals; cleared rows never count. */
export function worstAlarm(alarms: Alarm[], tags: Set<string>): 'critical' | 'warning' | undefined {
  let worst: 'critical' | 'warning' | undefined;
  for (const a of alarms) {
    if (a.state === 'cleared' || !tags.has(a.tag)) continue;
    if (a.severity === 'critical') return 'critical';
    worst = 'warning';
  }
  return worst;
}

export function buildRows({ equipment, primary, now, latest, commands, rules, alarms, running, kinds, runTag }: {
  equipment: EqMeta[];
  primary: Record<string, string>;
  now: number;
  latest: Map<string, TagValue>;
  commands: Iterable<Command>;
  rules: AlarmRule[];
  alarms: Alarm[];
  running: boolean;
  /** command type of a tag, see COMMAND_KINDS */
  kinds: Record<string, CommandKindOfRow>;
  /** the line's run signal; only its owner shows a run state */
  runTag: string;
}): EquipmentRow[] {
  const all = [...commands];
  return equipment.map((eq, i) => {
    const tag = primary[eq.id] ?? eq.signals[0];
    const tv = latest.get(tag);
    const stale = staleOf(tv, now);
    const command = newestCommand(all, new Set(eq.signals));
    return {
      id: eq.id,
      seq: i + 1,
      labelKey: eq.labelKey,
      signals: eq.signals,
      tag,
      value: tv ? tv.v : null,
      reading: typeof tv?.v === 'number' ? tv.v : null,
      hasRunSignal: eq.signals.includes(runTag),
      limits: rowLimits(rules, tag),
      command: command ? { code: commandCode(kinds[command.tag] ?? 'other', command.value), at: command.updated_at ?? command.created_at ?? '' } : undefined,
      state: rowState(stale, running),
      alarm: worstAlarm(alarms, new Set(eq.signals)),
      quality: tv?.q,
      stale,
      ts: tv?.ts,
    };
  });
}

/** Feed state for the connection pill: ws state and the age of the last value. */
export function connOf(ws: string, lastTs: string | undefined, now: number): {
  state: 'live' | 'stale' | 'offline';
  ageMs?: number;
} {
  if (ws !== 'open') return { state: 'offline' };
  if (!lastTs) return { state: 'offline' };
  const age = now - Date.parse(lastTs);
  if (!(age <= STALE_MS)) return { state: 'stale', ageMs: age };
  return { state: 'live', ageMs: Math.max(0, age) };
}

/** Case-insensitive filter over the visible name and the raw tag. */
export function matches(fields: string[], query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => f.toLowerCase().includes(q));
}

export type LogLevel = 'info' | 'warning' | 'error';
const LEVEL_RANK: Record<LogLevel, number> = { info: 0, warning: 1, error: 2 };

/** Log level of a journal entry from its severity; unknown reads as info. */
export function levelOf(severity: string | undefined): LogLevel {
  const s = (severity ?? '').toLowerCase();
  if (s === 'critical' || s === 'error') return 'error';
  if (s === 'warning' || s === 'warn') return 'warning';
  return 'info';
}

/** True when the entry is at or above the chosen level. */
export function atLevel(severity: string | undefined, min: LogLevel): boolean {
  return LEVEL_RANK[levelOf(severity)] >= LEVEL_RANK[min];
}
