// Client-side live store: mutable, outside React. Mutations bump domain-specific
// revision counters and schedule a requestAnimationFrame flush that notifies
// subscribers once per frame max (browser-side backpressure per design doc 07).

import type {
  Alarm, Command, Health, Quality, SystemHealth, TagInfo, TagValue, WSState,
} from '../types';

export const BUFFER_CAP = 3600; // ~1h at 1s sim cadence
export const STALE_MS = 15_000; // spec: tag silent >15s -> STALE

export interface BufferPoint {
  t: number; // epoch ms
  v: number; // booleans normalized to 0/1
}

type Listener = () => void;

class LiveStore {
  tags: TagInfo[] = [];
  latest = new Map<string, TagValue>();
  buffers = new Map<string, BufferPoint[]>();
  alarms: Alarm[] = [];
  commands = new Map<string, Command>();
  health: Health | null = null;
  sysHealth: SystemHealth | null = null;
  ws: WSState = 'connecting';

  /** bumped on every flush that touched tag data */
  version = 0;
  alarmRev = 0;
  cmdRev = 0;
  healthRev = 0;
  wsRev = 0;
  tagRev = 0;
  authRev = 0; // bumped when the bearer token changes (re-render role gates)

  private listeners = new Set<Listener>();
  private rafId = 0;
  private dirty = false;

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private scheduleFlush() {
    this.dirty = true;
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      if (!this.dirty) return;
      this.dirty = false;
      this.version++;
      this.listeners.forEach((fn) => fn());
    });
  }

  /** Synchronous notify for non-tag changes (revisions already bumped). */
  private poke() {
    this.scheduleFlush();
  }

  setTags(tags: TagInfo[]) {
    this.tags = tags;
    this.tagRev++;
    this.poke();
  }

  pushTag(name: string, v: number | boolean, q: Quality, ts: string) {
    this.latest.set(name, { v, q, ts });
    const num = typeof v === 'boolean' ? (v ? 1 : 0) : v;
    let buf = this.buffers.get(name);
    if (!buf) {
      buf = [];
      this.buffers.set(name, buf);
    }
    buf.push({ t: Date.parse(ts) || Date.now(), v: num });
    if (buf.length > BUFFER_CAP) buf.splice(0, buf.length - BUFFER_CAP);
    this.scheduleFlush();
  }

  upsertAlarm(a: Alarm) {
    const i = this.alarms.findIndex((x) => x.id === a.id);
    if (i >= 0) this.alarms[i] = { ...this.alarms[i], ...a };
    else this.alarms.unshift(a);
    // keep list bounded
    if (this.alarms.length > 500) this.alarms.length = 500;
    this.alarmRev++;
    this.poke();
  }

  setAlarms(alarms: Alarm[]) {
    this.alarms = alarms;
    this.alarmRev++;
    this.poke();
  }

  mergeCommand(c: Partial<Command> & { id: string }) {
    const prev = this.commands.get(c.id);
    this.commands.set(c.id, { ...prev, ...c } as Command);
    this.cmdRev++;
    this.poke();
  }

  setHealth(h: Health | null) {
    this.health = h;
    this.healthRev++;
    this.poke();
  }

  setSysHealth(h: SystemHealth | null) {
    this.sysHealth = h;
    this.healthRev++;
    this.poke();
  }

  bumpAuth() {
    this.authRev++;
    this.poke();
  }

  setWsState(s: WSState) {
    if (this.ws === s) return;
    this.ws = s;
    this.wsRev++;
    this.poke();
  }
}

export const live = new LiveStore();
