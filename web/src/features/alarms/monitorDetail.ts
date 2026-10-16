// Pure derivations for the monitor-detail additions — kept component-free so
// the page, the strip and tests share one implementation.

import type { Alarm, AlarmRule } from '../../types';
import { normSeverity } from '../../shared/ui/Status';

/** Same vocabulary as the monitors list `cond()` — kept in one place so the
 *  detail page never diverges from what the list shows. */
export function ruleCondition(rule: AlarmRule, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (rule.kind === 'stale') return t('mon.cond.stale', { v: rule.stale_s ?? '—' });
  if (rule.kind === 'roc') return t('mon.cond.roc', { v: rule.threshold ?? '—' });
  if (rule.threshold == null) return t('mon.cond.none');
  return t(rule.kind === 'lo' || rule.kind === 'lolo' ? 'mon.cond.lt' : 'mon.cond.gt', { v: rule.threshold });
}

export interface StripSeg { from: number; to: number; level: 'ok' | 'warn' | 'alarm' }

/** Merge the alarm records for this rule+signal into a status strip across
 *  [from, to]: covered spans take warn/alarm by severity (overlaps resolve
 *  to the worst), uncovered spans are ok — "no alarm raised" IS the ok state
 *  for a watched signal, not missing data. */
export function statusStrip(alarms: Alarm[], ruleName: string, tag: string, from: number, to: number): StripSeg[] {
  const spans = alarms
    .filter((a) => a.rule === ruleName && a.tag === tag)
    .map((a) => {
      const t0 = Date.parse(a.ts);
      const t1 = a.cleared_at ? Date.parse(a.cleared_at) : a.state === 'cleared' ? t0 : to;
      return { t0, t1: Math.max(t1, t0), level: normSeverity(a.severity) === 'critical' ? 'alarm' as const : 'warn' as const };
    })
    .filter((s) => s.t1 > from && s.t0 < to)
    .map((s) => ({ ...s, t0: Math.max(s.t0, from), t1: Math.min(s.t1, to) }))
    .sort((a, b) => a.t0 - b.t0 || (a.level === 'alarm' ? -1 : 1));
  const out: StripSeg[] = [];
  let cur = from;
  for (const s of spans) {
    if (s.t0 > cur) out.push({ from: cur, to: s.t0, level: 'ok' });
    if (s.t1 > cur) {
      out.push({ from: Math.max(s.t0, cur), to: s.t1, level: s.level });
      cur = s.t1;
    }
  }
  if (cur < to) out.push({ from: cur, to, level: 'ok' });
  return out;
}
