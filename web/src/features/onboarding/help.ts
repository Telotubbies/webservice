// In-app help links (roadmap 8.5). HELP_BASE points at the docs tree every
// "Learn more" link in an empty state resolves against — the repo docs path
// is the default; a deployed docs site overrides it at build time via
// VITE_HELP_BASE.

export const HELP_BASE: string =
  (import.meta.env.VITE_HELP_BASE as string | undefined)
  ?? 'https://github.com/vissointan/wds/tree/main/docs';

/** Doc slugs used by the pages this work stream touches. Keys are stable;
 *  paths map onto the repo docs layout. */
export const HELP: Record<string, string> = {
  gettingStarted: `${HELP_BASE}/superpowers/specs/2026-10-16-saas-launch-roadmap.md#phase-1-self-serve-accounts-and-tenancy`,
  gateway: `${HELP_BASE}/superpowers/specs/2026-10-16-saas-launch-roadmap.md#phase-2-getting-data-in-already-specified`,
  dataSource: `${HELP_BASE}/superpowers/specs/2026-10-16-saas-launch-roadmap.md#phase-2-getting-data-in-already-specified`,
  dashboards: `${HELP_BASE}/superpowers/specs/2026-10-16-saas-launch-roadmap.md#phase-4-turn-every-page-real-or-hide-it`,
  alarmRules: `${HELP_BASE}/superpowers/specs/2026-10-16-saas-launch-roadmap.md#phase-3-alerting-that-reaches-people`,
  notify: `${HELP_BASE}/superpowers/specs/2026-10-16-saas-launch-roadmap.md#31-notification-channels-per-org`,
  invite: `${HELP_BASE}/superpowers/specs/2026-10-16-saas-launch-roadmap.md#14-members-and-roles-extend-what-exists`,
  events: `${HELP_BASE}/superpowers/specs/2026-10-16-saas-launch-roadmap.md#phase-4-turn-every-page-real-or-hide-it`,
  logs: `${HELP_BASE}/superpowers/specs/2026-10-16-saas-launch-roadmap.md#phase-4-turn-every-page-real-or-hide-it`,
  query: `${HELP_BASE}/superpowers/specs/2026-10-16-saas-launch-roadmap.md#phase-4-turn-every-page-real-or-hide-it`,
  status: `${HELP_BASE}/superpowers/specs/2026-10-16-saas-launch-roadmap.md#phase-8-trust-legal-and-support-needed-before-the-first-paid-customer`,
};

export function helpUrl(key: keyof typeof HELP | string): string {
  return HELP[key] ?? HELP_BASE;
}
