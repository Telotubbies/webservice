// In-app help links (roadmap 8.5). Every "Learn more" link resolves to a
// section of the in-app user guide (/guide); a deployed docs site can take
// over by setting VITE_HELP_BASE, which is then used as an external base.

const EXTERNAL = import.meta.env.VITE_HELP_BASE as string | undefined;
export const HELP_BASE: string = EXTERNAL ?? '/guide';

/** Doc slugs → guide sections. Keys are stable; values are section ids. */
const SECTION: Record<string, string> = {
  gettingStarted: 'start', gateway: 'connect', dataSource: 'sources', dashboards: 'trends',
  alarmRules: 'rules', notify: 'notify', invite: 'people', events: 'alarms',
  logs: 'connect', query: 'trends', status: 'status',
};
export const HELP: Record<string, string> = Object.fromEntries(
  Object.entries(SECTION).map(([k, id]) => [k, EXTERNAL ? `${EXTERNAL}#${id}` : `/guide#${id}`]),
);

/** Slug → docs URL; unknown slugs land on the docs root rather than 404ing. */
export function helpUrl(key: keyof typeof HELP | string): string {
  return HELP[key] ?? HELP_BASE;
}
