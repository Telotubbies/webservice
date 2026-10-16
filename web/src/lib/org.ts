// Active-org selection. Pure helpers (tested) + the loader that resolves a
// membership to a concrete org/site Scope.

import { adminApi, type MeResponse } from './api';
import { setScope, type Scope } from './scope';

const STORE_KEY = 'wds.org';

type Membership = MeResponse['memberships'][number];

/** Stored org wins while it is still a membership; otherwise the first one. */
export function pickInitialOrg(memberships: Membership[], storedId: string | null): Membership | null {
  if (memberships.length === 0) return null;
  return memberships.find((m) => m.org_id === storedId) ?? memberships[0];
}

function readStored(): string | null {
  try { return localStorage.getItem(STORE_KEY); } catch { return null; }
}

function writeStored(orgId: string): void {
  try { localStorage.setItem(STORE_KEY, orgId); } catch { /* private mode */ }
}

/** Resolve a membership to its first site and make it the active scope. */
export async function activateOrg(m: Membership): Promise<Scope | null> {
  const sites = await adminApi.sites(m.org_id);
  const site = sites.items[0];
  if (!site) { setScope(null); return null; }
  const sc: Scope = { orgId: m.org_id, siteId: site.id, orgName: m.org_name ?? m.org_id, role: m.role };
  writeStored(m.org_id);
  setScope(sc);
  return sc;
}

/** Called after /me: choose the remembered (or first) org. */
export async function initScope(me: MeResponse): Promise<Scope | null> {
  const m = pickInitialOrg(me.memberships, readStored());
  if (!m) { setScope(null); return null; }
  return activateOrg(m);
}
