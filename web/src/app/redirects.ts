// Legacy URL → new URL (spec §5.1). Old links live on in notification
// e-mails, push payloads, bookmarks and the guide, so every moved route keeps
// working: App.tsx mounts each `from` with <LegacyRedirect/>, which resolves
// here and replaces the history entry. `:param` segments carry over and the
// query string is kept. /ack/:token and /status never move.

export const LEGACY: ReadonlyArray<readonly [from: string, to: string]> = [
  ['/line', '/live'],
  ['/line3d', '/'],                       // the 3D twin is the console's home
  ['/line3d/map', '/setup/model'],
  ['/structure', '/setup/structure'],
  ['/tags', '/setup/tags'],
  ['/admin/rules', '/setup/rules'],
  ['/admin/rules/new', '/setup/rules/new'],
  ['/infrastructure', '/connect/gateways'],
  ['/infrastructure/sources', '/connect/sources'],
  ['/infrastructure/sources/:edgeId', '/connect/gateways/:edgeId'],
  ['/infrastructure/map', '/connect'],
  ['/infrastructure/profiles', '/connect/profiles'],
  ['/infrastructure/add', '/connect/add'],
  ['/infrastructure/cameras', '/vision/cameras'],
  ['/infrastructure/models', '/vision/models'],
  ['/infrastructure/rules', '/vision/rules'],
  ['/infrastructure/events', '/vision/events'],
  ['/oee', '/production/oee'],
  ['/stops', '/production/stops'],
  ['/shifts', '/production/shifts'],
  ['/reports', '/production/reports'],
  ['/health', '/connect/health'],
];

const segs = (p: string) => p.replace(/\/+$/, '').split('/').filter(Boolean);

/** The new URL for a legacy path, or null when the path has not moved. */
export function resolveLegacy(pathname: string, search: string): string | null {
  const have = segs(pathname);
  for (const [from, to] of LEGACY) {
    const want = segs(from);
    if (want.length !== have.length) continue;
    const params: Record<string, string> = {};
    if (!want.every((w, i) => (w.startsWith(':') ? ((params[w.slice(1)] = have[i]), true) : w === have[i]))) continue;
    const path = to.replace(/:(\w+)/g, (_, k: string) => encodeURIComponent(decodeURIComponent(params[k] ?? '')));
    return `${path}${search}`;
  }
  return null;
}
