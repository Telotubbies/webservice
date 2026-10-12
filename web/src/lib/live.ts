// Client-side live store: mutable, outside React. Mutations bump domain-specific
// revision counters and schedule a requestAnimationFrame flush that notifies
// subscribers once per frame max (browser-side backpressure per design doc 07).

import type {
  Alarm, Command, Health, Insight, Quality, SystemHealth, TagInfo, TagValue, WSState,
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
  insights: Insight[] = [];
  commands = new Map<string, Command>();
  health: Health | null = null;
  sysHealth: SystemHealth | null = null;
  ws: WSState = 'connecting';

  /** cold-start flags (v4 T12): false until the first REST seed lands —
   *  pages show shaped skeletons before this, never an "empty" state that
   *  would lie about the plant being quiet. seedError flips when a boot
   *  fetch fails so panels surface an error instead of skeletons forever. */
  tagsSeeded = false;
  alarmsSeeded = false;
  insightsSeeded = false;
  seedError = false;

  /** bumped on every flush that touched tag data */
  version = 0;
  alarmRev = 0;
  insightRev = 0;
  cmdRev = 0;
  healthRev = 0;
  wsRev = 0;
  tagRev = 0;
  seedRev = 0; // bumped when seedError flips
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

  /** Boot-seed failure marker — set by the boot fetch .catch() arms, cleared
   *  by the next successful seed of any domain (or an explicit retry). */
  setSeedError() {
    if (this.seedError) return;
    this.seedError = true;
    this.seedRev++;
    this.poke();
  }

  private clearSeedError() {
    if (!this.seedError) return;
    this.seedError = false;
    this.seedRev++;
  }

  setTags(tags: TagInfo[]) {
    this.tags = tags;
    this.tagsSeeded = true;
    this.tagRev++;
    this.clearSeedError();
    this.poke();
  }

  pushTag(name: string, v: number | boolean, q: Quality, ts: string) {
    // a WS tag push is live data too — first push ends the cold-start
    // skeleton even if the REST seed hasn't landed yet (T12 review)
    if (!this.tagsSeeded) { this.tagsSeeded = true; this.tagRev++; }
    this.clearSeedError();
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
    if (!this.alarmsSeeded) this.alarmsSeeded = true; // WS push seeds too
    this.clearSeedError();
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
    this.alarmsSeeded = true;
    this.alarmRev++;
    this.clearSeedError();
    this.poke();
  }

  mergeInsight(i: Insight) {
    if (!this.insightsSeeded) this.insightsSeeded = true; // WS push seeds too
    this.clearSeedError();
    const idx = this.insights.findIndex((x) => x.id === i.id);
    if (idx >= 0) this.insights[idx] = { ...this.insights[idx], ...i };
    else this.insights.unshift(i);
    // keep list bounded
    if (this.insights.length > 500) this.insights.length = 500;
    this.insightRev++;
    this.poke();
  }

  setInsights(insights: Insight[]) {
    this.insights = insights;
    this.insightsSeeded = true;
    this.insightRev++;
    this.clearSeedError();
    this.poke();
  }

  /** Reconcile after a WS (re)connect: the server's open set is authoritative.
   *  Fetched opens merge over local rows; locally-open ids absent from the
   *  fetched set are dropped (they closed while we were disconnected — keep
   *  locally-known closed rows so the table doesn't flicker). */
  syncOpenInsights(opens: Insight[]) {
    const openIds = new Set(opens.map((i) => i.id));
    const merged = [...opens];
    for (const i of this.insights) {
      if (openIds.has(i.id)) continue;   // fresh server copy wins
      if (i.state === 'open') continue;  // stale open — closed while offline
      merged.push(i);
    }
    this.insights = merged;
    this.insightRev++;
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
