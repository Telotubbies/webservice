// Session + control gating. This is UX only: the backend enforces every rule
// (CONTRACT.v2, doc 16). The gate exists to tell the operator *why* controls
// are unavailable instead of silently hiding them (ADR-14).
//
// v4 T5: the session role comes from GET /api/me (memberships table), not
// from parsing the token locally — the same answer for dev tokens and OIDC.

import {
  api, getToken, setSessionToken, type SessionRole,
} from '../lib/api';
import { live } from '../lib/live';
import { reconnectWS } from '../lib/ws';
import { useStore, useViewport } from '../lib/hooks';
import { oidcEnabled, signOutSSO } from '../features/auth/oidc';

let sessionRole: SessionRole = 'none';
let meResolved = false;

export function getSessionRole(): SessionRole {
  return sessionRole;
}

/** Refresh role/display state from the backend. Clears the token on 401. */
export async function refreshSession(): Promise<SessionRole> {
  try {
    const me = await api.me();
    sessionRole = (me.role as SessionRole) ?? 'none';
  } catch {
    if (getToken()) setSessionToken('');
    sessionRole = 'none';
  }
  meResolved = true;
  live.bumpAuth();
  return sessionRole;
}

export function useRole(): SessionRole {
  useStore(() => live.authRev);
  return sessionRole;
}

/** Authenticated but no org membership — the wall shows the denied copy. */
export function useDenied(): boolean {
  useStore(() => live.authRev);
  return meResolved && getToken() !== '' && sessionRole === 'none';
}

export function canOperate(role: SessionRole): boolean {
  return role === 'operator' || role === 'admin' || role === 'owner';
}

/** APP_ENV=dev sign-in path — a demo bearer token. */
export function signIn(token: string): void {
  meResolved = false;
  setSessionToken(token.trim());
  live.bumpAuth();
  void refreshSession();
  reconnectWS();
}

export function signOut(): void {
  meResolved = false;
  if (oidcEnabled()) {
    // full SSO logout — the IdP calls the backend's backchannel logout,
    // which revokes the session everywhere (≤5s)
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
  if (!hasToken()) return { allowed: false, reason: 'guest' };
  if (!canOperate(role)) return { allowed: false, reason: 'role' };
  if (vp === 'xs' || vp === 'tiny') return { allowed: false, reason: 'viewport' };
  if (health && health.edge !== 'up') return { allowed: false, reason: 'edge' };
  if (sys?.edge?.clock_ok === false) return { allowed: false, reason: 'clock' };
  return { allowed: true };
}
