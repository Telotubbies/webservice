// Rule → monitor row: a Datadog "monitor" is our alarm rule plus the live
// state of its alarms. Pure so the page and tests share one derivation.
import { live, STALE_MS } from '../../lib/live';
import { equipmentOf } from '../../lib/plant';
import { normSeverity } from '../../shared/ui/Status';
import type { Alarm, AlarmRule } from '../../types';

export type MonStatus = 'alert' | 'warn' | 'nodata' | 'ok' | 'disabled';
export const STATUS_ORDER: MonStatus[] = ['alert', 'warn', 'nodata', 'ok', 'disabled'];

export interface MonitorRow {
  key: string; rule: AlarmRule; status: MonStatus; open: number;
  muted: boolean; area: string; severity: 'critical' | 'warning' | 'info';
}

export function monitorRows(rules: AlarmRule[], alarms: Alarm[], now: number): MonitorRow[] {
  const live_ = alarms.filter((a) => a.state !== 'cleared');
  // the alarm's rule string is the rule name, sometimes with the limit appended
  const forRule = (r: AlarmRule) => live_.filter((a) => a.rule === r.name || (a.tag === r.tag && a.rule.startsWith(r.name)));
  return rules.map((rule, i) => {
    const open = forRule(rule);
    const tv = rule.tag ? live.latest.get(rule.tag) : undefined;
    const fresh = !!tv && now - Date.parse(tv.ts) <= STALE_MS && tv.q === 'good';
    let status: MonStatus;
    if (!rule.enabled) status = 'disabled';
    else if (open.length) status = open.some((a) => normSeverity(a.severity) === 'critical') ? 'alert' : 'warn';
    else status = fresh ? 'ok' : 'nodata';
    return {
      key: `${rule.name}#${i}`, rule, status, open: open.length,
      muted: open.some((a) => !!a.shelved_until && Date.parse(a.shelved_until) > now),
      area: (rule.tag && equipmentOf(rule.tag)) || '',
      severity: normSeverity(rule.severity),
    };
  });
}

export function matchMonitor(r: MonitorRow, q: string, label: (tag: string) => string): boolean {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const hay = `${r.rule.name} ${r.rule.tag ?? ''} ${r.rule.tag ? label(r.rule.tag) : ''} ${r.area} ${r.rule.kind}`.toLowerCase();
  return tokens.every((t) => hay.includes(t));
}
