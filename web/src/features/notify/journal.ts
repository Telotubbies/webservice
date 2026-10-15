// F05 notification journal helpers (Datadog notification-center pattern).
// The ring itself lives on the live store (`live.journal`, written only by
// lib/ws.ts dispatch — zero fetches); this module owns the read-side state
// the bell needs: the lastSeen watermark and per-kind presentation maps.
//
// lastSeen is an epoch-ms watermark: every journal entry with ts > lastSeen
// counts as unread. Persisted to localStorage so a reload doesn't re-flag
// the session's history (journal rows themselves are session-only; newer
// events still compare correctly against an older watermark).

import type { JournalEvent } from '../../lib/live';
import type { IconName } from '../../shared/ui/Icon';
import { normSeverity } from '../../shared/ui/Status';

export type { JournalEvent };

const SEEN_KEY = 'wds.notifySeen';

function readSeen(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0; // storage denied — session-only unread state
  }
}

let lastSeen = readSeen();

export function lastSeenTs(): number {
  return lastSeen;
}

/** Mark every current entry read and persist the watermark. Returns the new
 *  watermark so the caller can mirror it into component state. */
export function markJournalRead(journal: readonly JournalEvent[]): number {
  const newest = journal[0];
  lastSeen = (newest && Date.parse(newest.ts)) || Date.now();
  try {
    localStorage.setItem(SEEN_KEY, String(lastSeen));
  } catch {
    /* storage denied */
  }
  return lastSeen;
}

export function isUnread(ev: JournalEvent, seen: number): boolean {
  return (Date.parse(ev.ts) || 0) > seen;
}

/** Kind glyph per journal row. alarm_update splits on the transition —
 *  cleared reads as a resolved check, acked as a plain check. */
export function journalIcon(ev: JournalEvent): IconName {
  switch (ev.kind) {
    case 'alarm':
      return 'alarm';
    case 'alarm_update':
      return ev.params?.state === 'cleared' ? 'check-circle' : 'check';
    case 'insight':
      return 'sparkle';
    case 'command':
      return 'commands';
    case 'health':
      return 'health';
    case 'auth':
      return 'lock';
  }
}

/** Left-rail tone: real severities pass through normSeverity; non-severity
 *  kinds map to a semantic tone (edge/command failures warn, recoveries ok).
 *  'neutral' keeps the rail a plain hairline — hue is never decorative here. */
export type RailTone = 'critical' | 'warning' | 'info' | 'ok' | 'neutral';

export function journalTone(ev: JournalEvent): RailTone {
  if (ev.severity) return normSeverity(ev.severity);
  switch (ev.kind) {
    case 'health':
      return ev.title === 'notify.edgeUp' ? 'ok' : 'warning';
    case 'command':
      return ev.params?.status === 'done' ? 'ok' : 'warning';
    default:
      return 'neutral';
  }
}
