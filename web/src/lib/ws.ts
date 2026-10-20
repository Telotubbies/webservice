// WebSocket client for /ws per CONTRACT.md, reconnect design in ADR-0003:
//  - first-frame auth: {"type":"auth","token":…} — never ?token= in the URL
//    (query strings leak into access logs and proxy traces)
//  - reconnect with exponential backoff + jitter; online / tab-visible skip
//    the timer, a long-hidden tab releases its socket
//  - heartbeat: ping when idle, drop a socket that stays silent (half-open)
//  - resync after a reconnect (or a server `resync` notice): live events are
//    buffered while REST snapshots land, then replayed over them
//  - close 4401 -> silent token renew; 4403 -> terminal "forbidden"
//  - ring-buffered tag data + rAF flush (via live store)

import { api, getToken } from './api';
import { getScope } from './scope';
import { live } from './live';
import { ensureFreshToken } from '../features/auth/oidc';
import type { Alarm, CommandStatus, Insight, Quality, WSEvent } from '../types';
import {
  BACKFILL_MAX_TAGS, BACKFILL_MIN_GAP_MS, CMD_TERMINAL, HEARTBEAT_MS, HIDDEN_CLOSE_MS,
  ResyncBuffer, WATCHDOG_MS, backoffMs, closeAction, emptySnapshot,
} from './wsPolicy';

let sock: WebSocket | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let attempt = 0;
let stopped = true;

let everOpen = false;       // a socket has been open in this page life
let lastFrame = 0;          // epoch ms of the last inbound frame
let lastPing = 0;
let beat: ReturnType<typeof setInterval> | undefined;
let hiddenTimer: ReturnType<typeof setTimeout> | undefined;
let hiddenReleased = false; // socket dropped because the tab sat hidden
let resyncGen = 0;
let resyncing = false;
const pending = new ResyncBuffer();
let listening = false;

export function startWS(): void {
  stopped = false;
  listen();
  connect();
}

/** Force a fresh connection now (token change, org switch, banner retry). */
export function reconnectWS(): void {
  stopped = false;
  listen();
  reconnectNow();
}

export function stopWS(): void {
  stopped = true;
  clearTimeout(timer);
  clearTimeout(hiddenTimer);
  unlisten();
  dropSocket();
  live.setWsState('closed');
}

function reconnectNow(): void {
  attempt = 0;
  clearTimeout(timer);
  dropSocket();
  connect();
}

/** Detach and close the current socket without triggering the close path —
 *  a half-open socket may not fire onclose for minutes. */
function dropSocket(): void {
  stopBeat();
  resyncGen++;
  resyncing = false;
  pending.clear();
  const s = sock;
  sock = null;
  if (!s) return;
  s.onopen = s.onmessage = s.onclose = s.onerror = null;
  try {
    s.close();
  } catch {
    /* noop */
  }
}

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

// ── Page / network events ───────────────────────────────────────────────────

function onOnline(): void {
  if (!stopped && live.ws !== 'open') reconnectNow();
}

function onOffline(): void {
  // no point spinning the backoff against a dead network; `online` resumes
  clearTimeout(timer);
  if (!stopped) live.setWsState('reconnecting');
}

function onVisibility(): void {
  if (stopped) return;
  if (document.visibilityState === 'hidden') {
    clearTimeout(hiddenTimer);
    hiddenTimer = setTimeout(() => {
      if (stopped) return;
      hiddenReleased = true;
      clearTimeout(timer);
      dropSocket();
      live.setWsState('reconnecting');
    }, HIDDEN_CLOSE_MS);
    return;
  }
  clearTimeout(hiddenTimer);
  if (hiddenReleased || live.ws !== 'open') {
    hiddenReleased = false;
    reconnectNow();
  }
}

function listen(): void {
  if (listening) return;
  listening = true;
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  document.addEventListener('visibilitychange', onVisibility);
}

function unlisten(): void {
  if (!listening) return;
  listening = false;
  window.removeEventListener('online', onOnline);
  window.removeEventListener('offline', onOffline);
  document.removeEventListener('visibilitychange', onVisibility);
}

// ── Heartbeat ───────────────────────────────────────────────────────────────

function startBeat(s: WebSocket): void {
  stopBeat();
  lastFrame = lastPing = Date.now();
  beat = setInterval(() => {
    const now = Date.now();
    if (now - lastFrame > WATCHDOG_MS) {
      // half-open: nothing inbound (not even a pong) — treat as dropped
      dropSocket();
      scheduleReconnect();
    } else if (s.readyState === WebSocket.OPEN && now - lastFrame >= HEARTBEAT_MS
        && now - lastPing >= HEARTBEAT_MS) {
      lastPing = now;
      try {
        s.send('{"type":"ping"}');
      } catch {
        /* the watchdog handles a dead socket */
      }
    }
  }, 5_000);
}

function stopBeat(): void {
  clearInterval(beat);
  beat = undefined;
}

// ── Connection ──────────────────────────────────────────────────────────────

function connect(): void {
  if (stopped) return;
  live.setWsState(attempt === 0 ? 'connecting' : 'reconnecting');
  const s = new WebSocket(wsUrl());
  sock = s;

  s.onopen = () => {
    // First-frame auth — the server closes 4401 if this doesn't arrive in
    // its auth window or the token doesn't resolve. Anonymous is gone (T5):
    // the frame must carry a real OIDC/dev token.
    const sc = getScope();
    s.send(JSON.stringify({ type: 'auth', token: getToken(), ...(sc ? { site_id: sc.siteId } : {}) }));
    attempt = 0;
    startBeat(s);
    const reconnected = everOpen;
    everOpen = true;
    if (reconnected) {
      // events published while we were away are gone: rebuild from snapshots
      void resync(s);
    } else {
      live.setWsState('open');
    }
  };

  s.onmessage = (ev: MessageEvent<string>) => {
    lastFrame = Date.now();
    let msg: WSEvent;
    try {
      msg = JSON.parse(ev.data) as WSEvent;
    } catch {
      return;
    }
    // while snapshots are in flight, live data waits so it can be replayed on
    // top of them instead of being overwritten by an older snapshot
    if (resyncing && msg.type !== 'resync' && msg.type !== 'pong' && msg.type !== 'auth_expired') {
      pending.push(msg);
      return;
    }
    dispatch(msg);
  };

  s.onclose = (ev: CloseEvent) => {
    if (sock === s) sock = null;
    stopBeat();
    resyncGen++;
    resyncing = false;
    pending.clear();
    if (stopped) return;
    const action = closeAction(ev.code);
    if (action === 'renew') {
      // token expired/revoked server-side. Try a silent renew once — a
      // renewed token reconnects immediately; a dead session drops to the
      // sign-in wall (auth_expired state + 401 sweep clears the token).
      void ensureFreshToken().then((ok) => {
        if (ok && !stopped) {
          attempt = 0;
          connect();
        } else {
          stopped = true;
          live.setWsState('auth_expired');
        }
      });
      return;
    }
    if (action === 'forbidden') {
      // origin / site / per-IP cap — retrying cannot fix it; wait for the user
      stopped = true;
      live.setWsState('forbidden');
      return;
    }
    scheduleReconnect();
  };

  s.onerror = () => {
    try {
      s.close();
    } catch {
      /* noop */
    }
  };
}

function scheduleReconnect(): void {
  if (stopped) return;
  live.setWsState('reconnecting');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return; // `online` resumes
  clearTimeout(timer);
  timer = setTimeout(connect, backoffMs(attempt++));
}

// ── Resync ──────────────────────────────────────────────────────────────────

async function retrying<T>(fn: () => Promise<T>): Promise<T> {
  let err: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      return await fn();
    } catch (e) {
      err = e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw err;
}

/** Subscribe-first resync: live events are buffered (onmessage) while the
 *  REST snapshots are fetched, the snapshots replace local state, then the
 *  buffer is replayed minus anything the snapshots already supersede. */
async function resync(s: WebSocket): Promise<void> {
  const gen = ++resyncGen;
  resyncing = true;
  pending.clear();
  live.setWsState('resyncing');

  // charts: remember where each tag's buffer stops before snapshots add points
  const now = Date.now();
  const gaps: [string, number][] = [];
  for (const [name, buf] of live.buffers) {
    const last = buf[buf.length - 1]?.t;
    if (last !== undefined && now - last > BACKFILL_MIN_GAP_MS) gaps.push([name, last]);
  }

  const [tags, alarms, cmds, ins] = await Promise.allSettled([
    retrying(() => api.latestAll()),
    retrying(() => api.alarms()),
    retrying(() => api.listCommands(200)), // 403 for viewers — rejection is expected
    retrying(() => api.insights({ state: 'open' })),
  ]);
  if (gen !== resyncGen || stopped || sock !== s) return; // superseded or closed

  const snap = emptySnapshot();
  if (tags.status === 'fulfilled') {
    for (const r of tags.value) {
      live.pushTag(r.name, r.v, r.q, r.ts);
      snap.tags.set(r.name, Date.parse(r.ts) || 0);
    }
  }
  if (alarms.status === 'fulfilled') {
    live.setAlarms(alarms.value);
    for (const a of alarms.value) snap.alarms.set(String(a.id), a);
  }
  if (cmds.status === 'fulfilled') {
    live.mergeCommands(cmds.value);
    for (const c of cmds.value) snap.commands.set(c.id, c);
  }
  if (ins.status === 'fulfilled') {
    live.syncOpenInsights(ins.value);
    for (const i of ins.value) snap.insights.add(i.id);
  }

  resyncing = false;
  for (const m of pending.drain(snap)) dispatch(m);
  live.setWsState('open');
  void backfill(gaps.slice(0, BACKFILL_MAX_TAGS), gen);
}

/** Fill the outage hole in tag ring buffers from history (5 at a time). */
async function backfill(gaps: [string, number][], gen: number): Promise<void> {
  for (let i = 0; i < gaps.length; i += 5) {
    await Promise.all(gaps.slice(i, i + 5).map(async ([name, from]) => {
      try {
        const rows = await api.history(name, { from: new Date(from + 1).toISOString(), limit: 2000 });
        if (gen !== resyncGen) return;
        live.backfillTag(name, rows.map((r) => ({
          t: Date.parse(r.ts) || 0,
          v: typeof r.v === 'boolean' ? (r.v ? 1 : 0) : r.v,
        })).filter((p) => p.t > 0));
      } catch {
        /* a chart gap is cosmetic — never fail the reconnect over it */
      }
    }));
    if (gen !== resyncGen) return;
  }
}

function dispatch(msg: WSEvent): void {
  switch (msg.type) {
    case 'tag':
      live.pushTag(msg.name, msg.v, msg.q as Quality, msg.ts);
      break;
    case 'alarm':
    case 'alarm_update': {
      // backend may send {type, alarm:{...}} or a flat alarm object
      const a = (msg.alarm ?? msg) as Alarm;
      if (a && a.id != null) {
        live.upsertAlarm(a);
        live.pushJournal({
          kind: msg.type,
          severity: a.severity,
          // journal titles are i18n keys — translated at render
          title: msg.type === 'alarm' ? 'notify.alarmRaised'
            : a.state === 'cleared' ? 'notify.alarmCleared'
            : a.state === 'acked' ? 'notify.alarmAcked' : 'notify.alarmRaised',
          params: a.state ? { state: a.state } : undefined,
          tag: a.tag,
          href: `/alarms?alarm=${encodeURIComponent(String(a.id))}`,
        });
      }
      break;
    }
    case 'insight': {
      // backend may send {type, insight:{...}} or a flat insight object
      const i = (msg.insight ?? msg) as Insight;
      if (i && i.id != null) {
        live.mergeInsight(i);
        if (i.state === 'open') {
          live.pushJournal({
            kind: 'insight',
            severity: i.severity,
            title: 'notify.insightOpen',
            params: i.kind ? { kind: i.kind } : undefined,
            tag: i.tag,
            href: `?fp=${encodeURIComponent(i.tag)}`,
          });
        }
      }
      break;
    }
    case 'command':
      live.mergeCommand({
        id: msg.command_id,
        tag: msg.tag,
        status: msg.status as CommandStatus,
        detail: msg.detail,
        updated_at: new Date().toISOString(),
      });
      // server gates command events to operator+ — journal what arrives
      if (CMD_TERMINAL.has(msg.status)) {
        live.pushJournal({
          kind: 'command',
          title: 'notify.cmdDone',
          params: { status: msg.status },
          tag: msg.tag,
          href: '/commands',
        });
      }
      break;
    case 'health': {
      // journal edge transitions only — diff against the previous state
      const prevEdge = live.health?.edge;
      live.setHealth({
        status: 'ok',
        db: 'up',
        mqtt: msg.mqtt,
        edge: msg.edge,
      });
      if (prevEdge !== undefined && prevEdge !== msg.edge) {
        live.pushJournal({
          kind: 'health',
          title: msg.edge === 'up' ? 'notify.edgeUp' : 'notify.edgeDown',
          href: '/health',
        });
      }
      break;
    }
    case 'resync':
      // the server dropped events for this (slow) client — rebuild in place
      if (sock) void resync(sock);
      break;
    case 'pong':
      break; // heartbeat reply — onmessage already refreshed lastFrame
    case 'auth_expired':
      live.setWsState('auth_expired');
      live.pushJournal({ kind: 'auth', title: 'shell.sessionExpired' });
      stopped = true;
      dropSocket();
      break;
  }
}
