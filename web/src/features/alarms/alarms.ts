import { useMemo } from 'react';
import { live } from '../../lib/live';
import { useStore } from '../../lib/hooks';
import { normSeverity } from '../../shared/ui/Status';
import type { Alarm } from '../../types';

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
