// PWA plumbing: service-worker registration, install prompt, sign-out wipe.
// The worker (public/sw.js) caches only the app shell; this module makes sure
// nothing is left on the device when someone signs out.

import { useSyncExternalStore } from 'react';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

const VISITS = 'wds.visits';
const DISMISSED = 'wds.install.dismissed';

function store(): Storage | null {
  try { return localStorage; } catch { return null; }
}

/** Register the worker (production builds only — dev servers hot-reload). */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js').catch(() => undefined); });
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();               // we show our own, later and only when it is useful
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => { deferred = null; emit(); });
  // count one visit per browser session
  try {
    if (!sessionStorage.getItem('wds.visit')) {
      sessionStorage.setItem('wds.visit', '1');
      const s = store();
      s?.setItem(VISITS, String(Number(s.getItem(VISITS) ?? '0') + 1));
    }
  } catch { /* private mode */ }
}

export const isStandalone = (): boolean =>
  window.matchMedia('(display-mode: standalone)').matches
  || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const isIOS = (): boolean =>
  /iphone|ipad|ipod/i.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isMobileScreen = (): boolean => window.matchMedia('(max-width: 767px)').matches;

/** Show the install hint from the third visit on, on a phone, until dismissed. */
export function shouldOfferInstall(): boolean {
  const s = store();
  if (isStandalone() || !isMobileScreen()) return false;
  if (s?.getItem(DISMISSED)) return false;
  return Number(s?.getItem(VISITS) ?? '0') >= 3 && (deferred !== null || isIOS());
}

export function dismissInstall(): void {
  store()?.setItem(DISMISSED, '1');
  emit();
}

export async function promptInstall(): Promise<void> {
  if (!deferred) return;
  await deferred.prompt();
  await deferred.userChoice.catch(() => undefined);
  deferred = null;
  emit();
}

export function useInstallOffer(): boolean {
  return useSyncExternalStore(
    (f) => { subs.add(f); return () => { subs.delete(f); }; },
    shouldOfferInstall, shouldOfferInstall);
}

export const canPromptInstall = (): boolean => deferred !== null;

/** Browser online/offline, reactive. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (f) => {
      window.addEventListener('online', f);
      window.addEventListener('offline', f);
      return () => { window.removeEventListener('online', f); window.removeEventListener('offline', f); };
    },
    () => navigator.onLine, () => true);
}

/** Drop everything this app cached on the device. Called on sign-out. */
export async function wipeLocalCaches(): Promise<void> {
  try {
    if ('caches' in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    reg?.active?.postMessage({ type: 'CLEAR' });
  } catch { /* nothing cached, or storage blocked */ }
}
