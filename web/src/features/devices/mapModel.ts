// Network-map model — pure, so "who is drawn and what links to what" is
// tested without a DOM. Links come from real data only: a gateway connects to
// an equipment group when one of that gateway's own data sources reads a tag
// under it. No source, no line — the map never invents a mapping.

/** Disabled gateways and ones that never sent a heartbeat are parked into a
 *  single summary node instead of drawing lines that mean nothing. */
export function splitGateways<T extends { status: string; last_hb_at: string | null }>(edges: T[]): { active: T[]; parked: T[] } {
  const active: T[] = [];
  const parked: T[] = [];
  for (const e of edges) (e.status === 'disabled' || e.last_hb_at === null ? parked : active).push(e);
  return { active, parked };
}

/** UNS paths use '/', older ones '.'; whichever the path carries is its separator. */
export const pathSep = (path: string) => (path.includes('/') ? '/' : '.');

/** area/line/device/signal → area/line/device (a bare name stays itself). */
export function equipmentKey(path: string): string {
  const sep = pathSep(path);
  const parts = path.split(sep);
  return parts.length > 1 ? parts.slice(0, -1).join(sep) : path;
}

/** gateway id → tag paths its sources read  ⇒  set of "gatewayId|equipmentKey". */
export function gatewayLinks(pathsByGateway: Map<string, string[]>): Set<string> {
  const out = new Set<string>();
  for (const [gw, paths] of pathsByGateway) for (const p of paths) out.add(`${gw}|${equipmentKey(p)}`);
  return out;
}
