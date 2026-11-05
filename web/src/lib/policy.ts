// Org policy the UI needs everywhere: may command buttons show on a phone?
// Loaded once per org from /security (member-readable). This only decides what
// the screen offers; the backend still requires role, area rights and a recent
// second factor for every command.

import { useSyncExternalStore } from 'react';
import { request } from './api';

let mobileControl = false;
const subs = new Set<() => void>();

export function setMobileControl(v: boolean): void {
  if (v === mobileControl) return;
  mobileControl = v;
  subs.forEach((f) => f());
}

export async function loadOrgPolicy(orgId: string): Promise<void> {
  try {
    const r = await request<{ mobile_control?: boolean }>(`/api/v1/orgs/${encodeURIComponent(orgId)}/security`);
    setMobileControl(!!r.mobile_control);
  } catch { /* keep the safe default: off */ }
}

export function useMobileControl(): boolean {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; },
    () => mobileControl, () => false);
}
