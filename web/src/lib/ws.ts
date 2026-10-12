// WebSocket client for /ws per CONTRACT.md:
//  - first-frame auth: {"type":"auth","token":…} — never ?token= in the URL
//    (query strings leak into access logs and proxy traces)
//  - reconnect with exponential backoff + jitter
//  - ring-buffered tag data + rAF flush (via live store)
//  - handles auth_expired event + close code 4401 -> "session expired" banner

import { api, getToken } from './api';
import { live } from './live';
import type { Alarm, CommandStatus, Insight, Quality, WSEvent } from '../types';

const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 15_000;
const JITTER = 0.25; // ±25%

let sock: WebSocket | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let attempt = 0;
let stopped = true;

export function startWS(): void {
  stopped = false;
  connect();
}

/** Force a fresh connection (e.g. after token change or banner retry). */
export function reconnectWS(): void {
  stopped = false;
  attempt = 0;
  clearTimeout(timer);
  try {
    sock?.close();
  } catch {
    /* noop */
  }
  connect();
}

export function stopWS(): void {
  stopped = true;
  clearTimeout(timer);
  try {
    sock?.close();
  } catch {
    /* noop */
  }
  live.setWsState('closed');
}

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

function connect(): void {
  if (stopped) return;
  live.setWsState(attempt === 0 ? 'connecting' : 'reconnecting');
  const s = new WebSocket(wsUrl());
  sock = s;

  s.onopen = () => {
    // First-frame auth — the server closes 4401 if this doesn't arrive in
    // its auth window or the token doesn't resolve. An empty token connects
    // as anonymous (read-only) until the T5 sign-in wall.
    s.send(JSON.stringify({ type: 'auth', token: getToken() }));
    attempt = 0;
    live.setWsState('open');
    // Resync open insights: insight events missed while disconnected would
    // otherwise leave stale local state indefinitely (e.g. an insight that
    // closed during the outage would look open forever).
    void api.insights({ state: 'open' })
      .then((rows) => live.syncOpenInsights(rows))
      .catch(() => {});
  };

  s.onmessage = (ev: MessageEvent<string>) => {
    let msg: WSEvent;
    try {
      msg = JSON.parse(ev.data) as WSEvent;
    } catch {
      return;
    }
    dispatch(msg);
  };

  s.onclose = (ev: CloseEvent) => {
    if (sock === s) sock = null;
    if (stopped) return;
    if (ev.code === 4401) {
      // token expired server-side; surface banner, do not reconnect
      stopped = true;
      live.setWsState('auth_expired');
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
  const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt++);
  const wait = exp * (1 - JITTER + Math.random() * JITTER * 2);
  timer = setTimeout(connect, wait);
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
      if (a && a.id != null) live.upsertAlarm(a);
      break;
    }
    case 'insight': {
      // backend may send {type, insight:{...}} or a flat insight object
      const i = (msg.insight ?? msg) as Insight;
      if (i && i.id != null) live.mergeInsight(i);
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
      break;
    case 'health':
      live.setHealth({
        status: 'ok',
        db: 'up',
        mqtt: msg.mqtt,
        edge: msg.edge,
      });
      break;
    case 'auth_expired':
      live.setWsState('auth_expired');
      stopped = true;
      try {
        sock?.close();
      } catch {
        /* noop */
      }
      break;
  }
}
