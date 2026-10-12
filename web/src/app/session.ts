// Session + control gating. This is UX only: the backend enforces every rule
// (CONTRACT.v2, doc 16). The gate exists to tell the operator *why* controls
// are unavailable instead of silently hiding them (ADR-14).

import { getToken, setToken, tokenRole, type TokenRole } from '../lib/api';
import { live } from '../lib/live';
import { reconnectWS } from '../lib/ws';
import { useStore, useViewport } from '../lib/hooks';

export function useRole(): TokenRole {
  useStore(() => live.authRev);
  return tokenRole();
}

export function canOperate(role: TokenRole): boolean {
  return role === 'operator' || role === 'custom';
}

export function signIn(token: string): void {
  setToken(token.trim());
  live.bumpAuth();
  reconnectWS();
}

export function signOut(): void {
  setToken('');
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
  if (role === 'none') return { allowed: false, reason: 'guest' };
  if (!canOperate(role)) return { allowed: false, reason: 'role' };
  if (vp === 'xs' || vp === 'tiny') return { allowed: false, reason: 'viewport' };
  if (health && health.edge !== 'up') return { allowed: false, reason: 'edge' };
  if (sys?.edge?.clock_ok === false) return { allowed: false, reason: 'clock' };
  return { allowed: true };
}
