import { useMemo } from 'react';
import { live } from '../../lib/live';
import { useStore } from '../../lib/hooks';
import { normSeverity } from '../../shared/ui/Status';
import { equipmentOf } from '../../lib/plant';
import type { Alarm, Severity } from '../../types';

const SEV_RANK = { critical: 0, warning: 1, info: 2 } as const;
const STATE_RANK: Record<string, number> = { active: 0, acked: 1, cleared: 2 };

/** ISA-18.2 ordering: unacknowledged first, then severity, then newest. */
export function sortAlarms(list: Alarm[]): Alarm[] {
  return [...list].sort((a, b) =>
    (STATE_RANK[a.state] ?? 3) - (STATE_RANK[b.state] ?? 3)
    || SEV_RANK[normSeverity(a.severity)] - SEV_RANK[normSeverity(b.severity)]
    || (Date.parse(b.ts) || 0) - (Date.parse(a.ts) || 0));
}

export function useAlarms() {
  const rev = useStore(() => live.alarmRev);
  return useMemo(() => {
    const all = sortAlarms(live.alarms);
    const open = all.filter((a) => a.state !== 'cleared');
    const active = all.filter((a) => a.state === 'active');
    const critical = open.filter((a) => normSeverity(a.severity) === 'critical');
    return { all, open, active, critical };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev]);
}

export const FLOOD_THRESHOLD = 10;

/* ---------------------------------------------------------- omnibar query
 * Datadog `key:value` token grammar, evaluated purely on the client against
 * the fields an Alarm actually carries (tag / rule / severity / state /
 * acked_by). Unknown `key:value` tokens degrade to free text so nothing a
 * user types can exclude rows by accident. Tokens AND together. */

const SEV_ALIAS: Record<string, Severity> = {
  critical: 'critical', crit: 'critical',
  warning: 'warning', warn: 'warning',
  info: 'info', advisory: 'info', adv: 'info',
};

const STATE_ALIAS: Record<string, string> = {
  active: 'active', triggered: 'active', unacked: 'active', open: 'active',
  acked: 'acked', ack: 'acked',
  cleared: 'cleared', resolved: 'cleared', closed: 'cleared',
};

export function matchAlarmQuery(a: Alarm, query: string, signalLabel: (tag: string) => string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const sev = normSeverity(a.severity);
  const label = signalLabel(a.tag).toLowerCase();
  const free = `${a.tag} ${label} ${a.rule} ${a.acked_by ?? ''}`.toLowerCase();
  return tokens.every((tok) => {
    const m = tok.match(/^([a-z_]+):(.*)$/);
    const key = m?.[1];
    const val = m?.[2];
    if (!key || !val) return free.includes(tok);
    switch (key) {
      case 'sev':
      case 'severity':
        return sev === (SEV_ALIAS[val] ?? val);
      case 'state':
      case 'is':
        return a.state === (STATE_ALIAS[val] ?? val);
      case 'tag':
        return a.tag.toLowerCase().includes(val) || label.includes(val);
      case 'rule':
        return a.rule.toLowerCase().includes(val);
      case 'by':
      case 'ack':
        return (a.acked_by ?? '').toLowerCase().includes(val);
      default:
        return free.includes(tok); // unknown facet key — treat literally
    }
  });
}

/* --------------------------------------------------------------- grouping
 * The list arrives already sortAlarms()-ordered, so grouping is a run-length
 * partition on (state, severity): unacked criticals form the top group, then
 * warnings/advisories, then acked and cleared groups — the sort stays honest,
 * headers only annotate it. */

export interface AlarmGroup {
  key: string;
  state: string;
  sev: Severity;
  alarms: Alarm[];
}

export function groupAlarms(sorted: Alarm[]): AlarmGroup[] {
  const groups: AlarmGroup[] = [];
  for (const a of sorted) {
    const sev = normSeverity(a.severity);
    const key = `${a.state}:${sev}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.alarms.push(a);
    else groups.push({ key, state: a.state, sev, alarms: [a] });
  }
  return groups;
}

const KNOWN_STATES = new Set(['active', 'acked', 'cleared']);

/** State label key that never leaks a raw backend string into i18n lookup. */
export function alarmStateKey(state: string): 'active' | 'acked' | 'cleared' | null {
  return KNOWN_STATES.has(state) ? (state as 'active' | 'acked' | 'cleared') : null;
}

/* ------------------------------------------------------- flood grouping (F03)
 * `?group=` buckets for the alarm list. `state` keeps the ISA-18.2 run-length
 * partition above; `rule` and `eq` collapse by rule name / equipment so one
 * flood reads as N rows under one parent (count + worst severity + span). */

export type GroupBy = 'state' | 'rule' | 'eq';
export const GROUP_BY: readonly GroupBy[] = ['state', 'rule', 'eq'];

export interface AlarmBucket {
  key: string;
  /** i18n key when the label is a fixed word; otherwise `label` is literal text */
  labelKey?: string;
  label?: string;
  worst: Severity;
  alarms: Alarm[];
  /** earliest raised_at across the bucket (ts is ISO) */
  oldest: string;
  newest: string;
}

export function bucketAlarms(sorted: Alarm[], by: GroupBy): AlarmBucket[] {
  const toBucket = (key: string, labelKey: string | undefined, label: string | undefined, list: Alarm[]): AlarmBucket => {
    const ts = list.map((a) => a.ts).filter(Boolean).sort();
    const worst = list.reduce<Severity>((w, a) => {
      const s = normSeverity(a.severity);
      return SEV_RANK[s] < SEV_RANK[w] ? s : w;
    }, 'info');
    return { key, labelKey, label, worst, alarms: list, oldest: ts[0] ?? '', newest: ts[ts.length - 1] ?? '' };
  };

  if (by === 'state') {
    return groupAlarms(sorted).map((g) => toBucket(g.key, `alarms.${alarmStateKey(g.state) ?? 'active'}`, undefined, g.alarms));
  }

  const m = new Map<string, Alarm[]>();
  for (const a of sorted) {
    const k = by === 'rule' ? a.rule : (equipmentOf(a.tag) ?? '');
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(a);
  }
  return [...m.entries()].map(([k, list]) => {
    if (by === 'rule') return toBucket(`rule:${k}`, undefined, k, list);
    // eq: known equipment gets its line label, unmapped tags fall into "Other"
    const eqKey = k ? `line.${k}` : 'alarms.groupOther';
    return toBucket(`eq:${k || 'other'}`, eqKey, undefined, list);
  });
}
