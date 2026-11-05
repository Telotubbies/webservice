// Pure reconnect policy for ws.ts (ADR-0003): timings, close-code handling and
// the resync event buffer. No DOM, no sockets — unit-tested with bun.

import type { Alarm, Command, Insight, WSEvent } from '../types';

export const BACKOFF_BASE_MS = 500;
export const BACKOFF_MAX_MS = 15_000;
export const JITTER = 0.25; // ±25%
export const HEARTBEAT_MS = 20_000; // ping when idle
export const WATCHDOG_MS = 30_000; // no inbound frame this long -> half-open, drop
export const HIDDEN_CLOSE_MS = 60_000; // hidden tab this long -> stop holding a socket
export const RESYNC_BUF_CAP = 2_000;
export const BACKFILL_MIN_GAP_MS = 10_000; // smaller gaps are not worth a history fetch
export const BACKFILL_MAX_TAGS = 50;

export const CMD_TERMINAL = new Set(['done', 'failed', 'denied', 'timeout']);

export type CloseAction = 'renew' | 'forbidden' | 'retry';

/** 4401 token expired/revoked -> renew once; 4403 origin/site/IP cap -> will
 *  not succeed by itself, stop and wait for the user; anything else is a
 *  normal drop (network, proxy, server restart). */
export function closeAction(code: number): CloseAction {
  if (code === 4401) return 'renew';
  if (code === 4403) return 'forbidden';
  return 'retry';
}

export function backoffMs(attempt: number, rand: () => number = Math.random): number {
  const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt);
  return exp * (1 - JITTER + rand() * JITTER * 2);
}

/** What the REST snapshots said, keyed for the stale-event check. */
export interface SnapshotIndex {
  tags: Map<string, number>;        // name -> epoch ms of latest value
  alarms: Map<string, Alarm>;       // String(id) -> row
  commands: Map<string, Command>;   // id -> row
  insights: Set<string>;            // ids present in the open set
}

export function emptySnapshot(): SnapshotIndex {
  return { tags: new Map(), alarms: new Map(), commands: new Map(), insights: new Set() };
}

/** True when a buffered live event is superseded by the snapshot and must not
 *  be replayed over it (replaying an older state would regress the UI). */
export function supersededBySnapshot(msg: WSEvent, snap: SnapshotIndex): boolean {
  switch (msg.type) {
    case 'tag': {
      const t = snap.tags.get(msg.name);
      return t !== undefined && Date.parse(msg.ts) < t;
    }
    case 'alarm':
    case 'alarm_update': {
      const a = (msg.alarm ?? msg) as Alarm;
      if (a?.id == null) return false;
      const s = snap.alarms.get(String(a.id));
      if (!s) return false;
      return a.version != null && s.version != null && a.version < s.version;
    }
    case 'command': {
      const s = snap.commands.get(msg.command_id);
      return !!s && CMD_TERMINAL.has(String(s.status)) && !CMD_TERMINAL.has(msg.status);
    }
    case 'insight': {
      const i = (msg.insight ?? msg) as Insight;
      // the open set is authoritative for what is open; an event for an id the
      // snapshot lists as open can only be older or equal
      return i?.id != null && snap.insights.has(i.id);
    }
    default:
      return false;
  }
}

/** Bounded FIFO holding live events while a resync is in flight. Overflow
 *  drops the oldest — harmless, the snapshot being fetched covers them. */
export class ResyncBuffer {
  private q: WSEvent[] = [];
  push(msg: WSEvent): void {
    this.q.push(msg);
    if (this.q.length > RESYNC_BUF_CAP) this.q.splice(0, this.q.length - RESYNC_BUF_CAP);
  }
  get size(): number { return this.q.length; }
  drain(snap: SnapshotIndex): WSEvent[] {
    const out = this.q.filter((m) => !supersededBySnapshot(m, snap));
    this.q = [];
    return out;
  }
  clear(): void { this.q = []; }
}
