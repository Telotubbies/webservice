// Web Push client. The server side is alarming/push.py; the payload it sends has
// no plant data, so nothing sensitive passes through the browser vendor's push
// service.

import { request } from './api';
import { isIOS, isStandalone } from './pwa';

export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on';

const subsUrl = (org: string) => `/api/v1/orgs/${encodeURIComponent(org)}/push-subscriptions`;

function supported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

export async function pushState(): Promise<PushState> {
  // iOS only exposes push to an app that was added to the home screen
  if (isIOS() && !isStandalone()) return 'needs-install';
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

function keyBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
}

const b64url = (buf: ArrayBuffer | null): string => {
  if (!buf) return '';
  let s = '';
  new Uint8Array(buf).forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Ask permission, subscribe this browser and register it with the server. */
export async function enablePush(orgId: string): Promise<PushState> {
  if (Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted') {
    return pushState();
  }
  const reg = (await registration()) ?? await navigator.serviceWorker.ready;
  const { key } = await request<{ key: string }>('/api/v1/push/vapid-key');
  const sub = (await reg.pushManager.getSubscription())
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  await request(subsUrl(orgId), {
    method: 'POST',
    body: JSON.stringify({
      endpoint: sub.endpoint,
      keys: { p256dh: b64url(sub.getKey('p256dh')), auth: b64url(sub.getKey('auth')) },
      ua: navigator.userAgent.slice(0, 280),
    }),
  });
  return 'on';
}

/** Stop notifications on this device: server row first, then the browser's. */
export async function disablePush(orgId: string): Promise<void> {
  const sub = await (await registration())?.pushManager.getSubscription();
  if (!sub) return;
  await request(`${subsUrl(orgId)}?endpoint=${encodeURIComponent(sub.endpoint)}`, { method: 'DELETE' })
    .catch(() => undefined);
  await sub.unsubscribe().catch(() => undefined);
}

export function testPush(orgId: string): Promise<{ sent: number; failed: number; devices: number }> {
  return request(`${subsUrl(orgId)}/test`, { method: 'POST' });
}
