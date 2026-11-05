// Active org + site the console acts on. Deliberately import-free so api.ts,
// ws.ts and the live store can all read it without a cycle.

export interface Scope {
  orgId: string;
  siteId: string;
  orgName: string;
  role: string;
}

let scope: Scope | null = null;
let rev = 0;
const listeners = new Set<() => void>();

export function getScope(): Scope | null {
  return scope;
}

export function scopeRev(): number {
  return rev;
}

export function setScope(next: Scope | null): void {
  const same = scope?.orgId === next?.orgId && scope?.siteId === next?.siteId && scope?.role === next?.role;
  scope = next;
  if (same) return;
  rev++;
  listeners.forEach((fn) => fn());
}

export function subscribeScope(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Headers that point the org-aware v1 endpoints at the active org/site. */
export function scopeHeaders(): Record<string, string> {
  return scope ? { 'X-WDS-Org': scope.orgId, 'X-WDS-Site': scope.siteId } : {};
}
