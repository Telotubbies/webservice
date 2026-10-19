// Session + control gating. This is UX only — the backend enforces every rule
// (CONTRACT.v2, doc 16). The gate exists to tell the operator *why* controls
// are unavailable instead of silently hiding them (ADR-14).
//
// The session role comes from GET /api/me (the memberships table), not from
// parsing the token locally, so dev tokens and OIDC get the same answer.

import {
  api, getToken, setSessionToken, type SessionRole,
} from '../lib/api';
import { live } from '../lib/live';
import { reconnectWS } from '../lib/ws';
import { useStore, useViewport } from '../lib/hooks';
import { oidcEnabled, signOutSSO } from '../features/auth/oidc';
import { getScope, setScope, subscribeScope } from '../lib/scope';
import { initScope } from '../lib/org';
import { disablePush } from '../lib/push';
import { wipeLocalCaches } from '../lib/pwa';
import { useMobileControl } from '../lib/policy';

// ── Module state ─────────────────────────────────────────────────────────────

let sessionRole: SessionRole = 'none';
let meResolved = false;
let noOrg = false;

// ── Org switching ────────────────────────────────────────────────────────────

// Switching org drops the old org's data and reopens the socket on the new site.
subscribeScope(() => {
  live.resetData();
  live.bumpAuth();
  reconnectWS();
});

// ── Session state API ────────────────────────────────────────────────────────

export function getSessionRole(): SessionRole {
  return sessionRole;
}

/** Refresh role/display state from the backend. Clears the token on 401. */
export async function refreshSession(): Promise<SessionRole> {
  try {
    const me = await api.me();
    const sc = await initScope(me);
    noOrg = sc == null && me.memberships.length === 0;
    sessionRole = ((sc?.role ?? me.role) as SessionRole) ?? 'none';
  } catch {
    if (getToken()) setSessionToken('');
    sessionRole = 'none';
    noOrg = false;
    setScope(null);
  }
  meResolved = true;
  live.bumpAuth();
  return sessionRole;
}

export function useRole(): SessionRole {
  useStore(() => live.authRev);
  return sessionRole;
}

/** Authenticated but no org membership — the app shows the denied wall. */
export function useDenied(): boolean {
  useStore(() => live.authRev);
  return meResolved && getToken() !== '' && sessionRole === 'none' && !noOrg;
}

/** Signed in with a verified identity but not a member of any org yet — the
 *  app shows "Create organization" instead of the denied wall. */
export function useNoOrg(): boolean {
  useStore(() => live.authRev);
  return meResolved && getToken() !== '' && noOrg;
}

export { getScope };

// ── Role predicates ──────────────────────────────────────────────────────────

export function canOperate(role: string): boolean {
  return role === 'operator' || role === 'admin' || role === 'owner';
}

/** admin|owner only — config:write / member:manage / audit:read (CONTRACT.v2 §1). */
export function canAdmin(role: string): boolean {
  return role === 'admin' || role === 'owner';
}

// ── Sign in / sign out ───────────────────────────────────────────────────────

/** Dev sign-in path (APP_ENV=dev) — a demo bearer token. */
export function signIn(token: string): void {
  meResolved = false;
  setSessionToken(token.trim());
  live.bumpAuth();
  void refreshSession();
  reconnectWS();
}

/** Leave nothing behind on the device: this browser's push subscription (so
 *  the next person on a shared phone does not get this user's alarms) and the
 *  worker's caches. Capped at 2 s so a dead network never blocks signing out. */
async function teardownDevice(): Promise<void> {
  const org = getScope()?.orgId;
  const work = (async () => {
    if (org) await disablePush(org).catch(() => undefined);
    await wipeLocalCaches();
  })();
  await Promise.race([work, new Promise((r) => setTimeout(r, 2000))]);
}

export function signOut(): void {
  void teardownDevice().finally(finishSignOut);
}

function finishSignOut(): void {
  meResolved = false;
  if (oidcEnabled()) {
    // Full SSO logout: the IdP calls the backend's backchannel logout, which
    // revokes the session everywhere (≤5 s).
    void signOutSSO();
    return;
  }
  setSessionToken('');
  sessionRole = 'none';
  live.commands.clear();
  live.bumpAuth();
  reconnectWS();
}

export function hasToken(): boolean {
  return getToken() !== '';
}

// ── Control gating ───────────────────────────────────────────────────────────

export type GateReason = 'guest' | 'role' | 'viewport' | 'edge' | 'clock';

export interface ControlGate {
  allowed: boolean;
  reason?: GateReason;
}

const REASON_KEY: Record<GateReason, string> = {
  guest: 'control.reasonGuest',
  role: 'control.reasonRole',
  viewport: 'control.reasonViewport',
  edge: 'control.reasonEdge',
  clock: 'control.reasonClock',
};

export function gateReasonKey(r: GateReason): string {
  return REASON_KEY[r];
}

export function useControlGate(): ControlGate {
  const role = useRole();
  const vp = useViewport();
  const health = useStore(() => live.health);
  const sys = useStore(() => live.sysHealth);
  const mobileControl = useMobileControl();
  if (!hasToken()) return { allowed: false, reason: 'guest' };
  if (!canOperate(role)) return { allowed: false, reason: 'role' };
  if ((vp === 'xs' || vp === 'tiny') && !mobileControl) return { allowed: false, reason: 'viewport' };
  if (health && health.edge !== 'up') return { allowed: false, reason: 'edge' };
  if (sys?.edge?.clock_ok === false) return { allowed: false, reason: 'clock' };
  return { allowed: true };
}
