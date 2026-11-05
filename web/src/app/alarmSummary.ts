// Always-visible alarm summary (ISA-18.2): counts per priority over alarms
// that still need someone — cleared ones are history, and a shelved alarm is
// out of the count only until its shelf expires. `unacked` is what makes the
// chip insist (solid fill / blink) instead of sitting quietly.

import type { Alarm } from '../types';
import { normSeverity } from '../shared/ui/severity';

export interface AlarmSummary { critical: number; warning: number; info: number; unacked: number }

export function summarizeAlarms(
  alarms: Pick<Alarm, 'state' | 'severity' | 'acked_at' | 'shelved_until'>[], now: number,
): AlarmSummary {
  const out: AlarmSummary = { critical: 0, warning: 0, info: 0, unacked: 0 };
  for (const a of alarms) {
    if (a.state === 'cleared') continue;
    if (a.shelved_until && Date.parse(a.shelved_until) > now) continue;
    out[normSeverity(a.severity)]++;
    if (a.state === 'active') out.unacked++;
  }
  return out;
}
