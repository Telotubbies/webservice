// WebSocket client for /ws per CONTRACT.md:
//  - first-frame auth: {"type":"auth","token":…} — never ?token= in the URL
//    (query strings leak into access logs and proxy traces)
//  - reconnect with exponential backoff + jitter
//  - ring-buffered tag data + rAF flush (via live store)
//  - handles auth_expired event + close code 4401 -> "session expired" banner

import { api, getToken } from './api';
import { getScope } from './scope';
import { live } from './live';
import { ensureFreshToken } from '../features/auth/oidc';
import type { Alarm, CommandStatus, Insight, Quality, WSEvent } from '../types';

const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 15_000;
const JITTER = 0.25; // ±25%

// F05 journal: only terminal command states are worth a notification;
// in-flight transitions (issued/sent/acked) would be noise.
const CMD_TERMINAL = new Set(['done', 'failed', 'denied', 'timeout']);

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
    // its auth window or the token doesn't resolve. Anonymous is gone (T5):
    // the frame must carry a real OIDC/dev token.
    const sc = getScope();
    s.send(JSON.stringify({ type: 'auth', token: getToken(), ...(sc ? { site_id: sc.siteId } : {}) }));
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
    case 'auth_expired':
      live.setWsState('auth_expired');
      live.pushJournal({ kind: 'auth', title: 'shell.sessionExpired' });
      stopped = true;
      try {
        sock?.close();
      } catch {
        /* noop */
      }
      break;
  }
}
