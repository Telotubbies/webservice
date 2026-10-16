// Shared nav model — one source of truth for the sidebar and palette.
// Icons are semantic names mapped to lucide glyphs (see shared/ui/ddicons.ts).

import type { DdIconName } from '../shared/ui/ddicons';

import { enabled } from '../lib/features';

export interface NavItem { to: string; key: string; icon: DdIconName; badge?: 'new'; flag?: string }
/** Flyout sub-section — dd mega-menu anatomy: bold title (+NEW badge),
 *  left-column items, optional right-column secondary links, blue +action row */
export interface NavSection {
  title?: string;            // i18n key; omit for an untitled section
  badge?: 'new';
  items: NavItem[];
  secondary?: NavItem[];
  action?: { to: string; key: string; flag?: string };
}
export interface NavGroup {
  /** rail cluster — a divider line is drawn where the cluster changes (Datadog rail) */
  cluster: 1 | 2 | 3 | 4;
  group: string; icon: DdIconName; items: NavItem[]; gated?: boolean;
  /** flyout anatomy; falls back to one anonymous section of `items` */
  sections?: NavSection[];
  action?: { to: string; key: string };
  /** the group's own landing page — the flyout title links here */
  href?: string;
}

const ALL_NAV: NavGroup[] = [
  { cluster: 1, group: 'nav.bitsAi', icon: 'ai-search', items: [
    { to: '/assistant', key: 'nav.assistant', icon: 'comment', flag: 'assistant' },
  ] },
  // Datadog IA, mapped to plant operations: group by job-to-be-done.
  { cluster: 1, group: 'nav.dashboards', icon: 'dashboard', items: [
    { to: '/', key: 'nav.overview', icon: 'home' },
    { to: '/dashboards', key: 'nav.dashboards', icon: 'dashboard', badge: 'new' },
    { to: '/line', key: 'nav.line', icon: 'service-map' },
    { to: '/line3d', key: 'nav.line3d', icon: 'building-block' },
    { to: '/notebooks', key: 'nav.notebooks', icon: 'notebook' },
  ], sections: [
    { title: 'nav.secDashboards', items: [
      { to: '/', key: 'nav.overview', icon: 'home' },
      { to: '/dashboards', key: 'nav.dashboards', icon: 'dashboard' },
    ], action: { to: '/dashboards?new=1', key: 'nav.actionNewDashboard' } },
    { title: 'nav.secNotebooks', items: [
      { to: '/notebooks', key: 'nav.notebooks', icon: 'notebook' },
    ], action: { to: '/notebooks?new=1', key: 'nav.actionNewNotebook' } },
    { title: 'nav.secLive', items: [
      { to: '/line', key: 'nav.line', icon: 'service-map' },
      { to: '/line3d', key: 'nav.line3d', icon: 'building-block' },
    ] },
  ] },
  { cluster: 1, group: 'nav.monitoring', icon: 'monitor', href: '/monitors', items: [
    { to: '/monitors', key: 'nav.monitors', icon: 'monitor' },
    { to: '/alarms', key: 'nav.alarms', icon: 'attention-circled' },
    { to: '/downtimes', key: 'nav.downtimes', icon: 'snooze' },
    { to: '/alarms/quality', key: 'nav.alarmQuality', icon: 'bell-curve' },
    { to: '/slos', key: 'nav.slos', icon: 'status-page' },
    { to: '/events', key: 'nav.events', icon: 'events' },
    { to: '/activity', key: 'nav.activity', icon: 'bell' },
  ], sections: [
    { title: 'nav.secMonitors', items: [
      { to: '/monitors', key: 'nav.monitors', icon: 'monitor' },
      { to: '/monitors/templates', key: 'nav.monTemplates', icon: 'books' },
    ] },
    { title: 'nav.secAlarms', items: [
      { to: '/alarms', key: 'nav.alarms', icon: 'attention-circled' },
      { to: '/downtimes', key: 'nav.downtimes', icon: 'snooze' },
      { to: '/alarms/quality', key: 'nav.alarmQuality', icon: 'bell-curve' },
    ], secondary: [
      { to: '/admin/rules', key: 'nav.adminRules', icon: 'assert-list' },
      { to: '/notifications/channels', key: 'nav.notifyChannels', icon: 'bell' },
      { to: '/alarms/settings', key: 'nav.alarmSettings', icon: 'cog', flag: 'alarmsettings' },
    ],
      action: { to: '/admin/rules/new', key: 'nav.actionNewRule' } },
    { title: 'nav.secReliability', items: [
      { to: '/slos', key: 'nav.slos', icon: 'status-page' },
      { to: '/activity', key: 'nav.activity', icon: 'bell' },
      { to: '/notifications/channels', key: 'nav.notifyChannels', icon: 'bell' },
    ] },
    { title: 'nav.secEvents', items: [
      { to: '/events', key: 'nav.events', icon: 'events' },
    ] },
  ] },
  { cluster: 2, group: 'nav.infrastructure', icon: 'server', items: [
    { to: '/infrastructure', key: 'nav.devices', icon: 'server', badge: 'new' },
    { to: '/infrastructure/map', key: 'nav.infraMap', icon: 'service-map' },
    { to: '/infrastructure/profiles', key: 'nav.infraProfiles', icon: 'assert-list' },
    { to: '/health', key: 'nav.health', icon: 'heartbeat' },
  ], action: { to: '/infrastructure/add', key: 'nav.addDevice' } },
  { cluster: 3, group: 'nav.metrics', icon: 'metric', items: [
    { to: '/trends', key: 'nav.trends', icon: 'graph-line' },
    { to: '/metrics', key: 'nav.metricsSummary', icon: 'metric' },
    { to: '/tags', key: 'nav.tags', icon: 'list' },
    { to: '/query', key: 'nav.query', icon: 'database' },
  ] },
  { cluster: 3, group: 'nav.production', icon: 'pause', items: [
    { to: '/oee', key: 'nav.oee', icon: 'metric' },
    { to: '/stops', key: 'nav.stops', icon: 'pause' },
    { to: '/shifts', key: 'nav.shifts', icon: 'on-call' },
    { to: '/reports', key: 'nav.reports', icon: 'download' },
  ] },
  { cluster: 3, group: 'nav.logs', icon: 'log-pipelines', items: [
    { to: '/logs', key: 'nav.logs', icon: 'log-pipelines' },
  ] },
  { cluster: 3, group: 'nav.errors', icon: 'error-tracking', items: [
    { to: '/errors', key: 'nav.errors', icon: 'error-tracking', flag: 'errors' },
  ] },
  { cluster: 1, group: 'nav.devPortal', icon: 'books', items: [
    { to: '/catalog', key: 'nav.catalog', icon: 'books', flag: 'catalog' },
  ] },
  { cluster: 1, group: 'nav.incidentResponse', icon: 'incidents', items: [
    { to: '/incidents', key: 'nav.incidents', icon: 'incidents', flag: 'incidents' },
    { to: '/teams', key: 'nav.teams', icon: 'on-call', flag: 'teams' },
  ] },
  { cluster: 1, group: 'nav.automation', icon: 'lightning-filled', items: [
    { to: '/commands', key: 'nav.commands', icon: 'prompt' },
  ] },
  { cluster: 2, group: 'nav.apm', icon: 'service-map', items: [
    { to: '/traces', key: 'nav.traces', icon: 'service-map', flag: 'traces' },
    { to: '/processes', key: 'nav.processes', icon: 'container', flag: 'processes' },
  ] },
  { cluster: 2, group: 'nav.digitalExperience', icon: 'eye', items: [
    { to: '/sessions', key: 'nav.sessions', icon: 'eye', flag: 'sessions' },
    { to: '/synthetics', key: 'nav.synthetics', icon: 'multi-heartbeat', flag: 'synthetics' },
  ] },
  { cluster: 2, group: 'nav.security', icon: 'security-monitoring', href: '/security', items: [
    { to: '/security', key: 'nav.secPosture', icon: 'security-monitoring' },
    { to: '/security/issues', key: 'nav.secIssues', icon: 'attention-circled' },
    { to: '/security/findings', key: 'nav.secFindings', icon: 'list' },
    { to: '/security/api', key: 'nav.secApi', icon: 'signpost' },
    { to: '/security/access', key: 'nav.secAccess', icon: 'key' },
  ], sections: [
    { title: 'nav.secCloud', items: [
      { to: '/security', key: 'nav.secPosture', icon: 'security-monitoring' },
      { to: '/security/issues', key: 'nav.secIssues', icon: 'attention-circled' },
      { to: '/security/findings', key: 'nav.secFindings', icon: 'list' },
    ] },
    { title: 'nav.secApiProtection', items: [
      { to: '/security/api', key: 'nav.secApi', icon: 'signpost' },
    ] },
    { title: 'nav.secAccess', items: [
      { to: '/security/access', key: 'nav.secAccess', icon: 'key' },
    ] },
  ] },
  { cluster: 2, group: 'nav.intelligence', icon: 'watchdog', items: [
    { to: '/insights', key: 'nav.insights', icon: 'ai-search' },
    { to: '/assistant', key: 'nav.assistant', icon: 'comment', flag: 'assistant' },
  ] },
  // admin: operators+ see it (mutations stay admin|owner server-side)
  { cluster: 4, group: 'nav.admin', icon: 'organization', gated: true, items: [
    { to: '/admin', key: 'nav.adminOrg', icon: 'organization' },
    { to: '/admin/rules', key: 'nav.adminRules', icon: 'assert-list' },
    { to: '/admin/users', key: 'nav.adminUsers', icon: 'users' },
    { to: '/admin/audit', key: 'nav.adminAudit', icon: 'audit-trail' },
  ], sections: [
    { title: 'admin.navOrg', items: [
      { to: '/admin', key: 'nav.adminOrg', icon: 'organization' },
      { to: '/admin/rules', key: 'nav.adminRules', icon: 'assert-list' },
    ] },
    { title: 'admin.navIdentity', items: [
      { to: '/admin/users', key: 'nav.adminUsers', icon: 'users' },
    ], action: { to: '/admin/users', key: 'nav.actionInvite' } },
    { title: 'admin.navAccess', items: [
      { to: '/admin/audit', key: 'nav.adminAudit', icon: 'audit-trail' },
      { to: '/admin/keys', key: 'nav.adminKeys', icon: 'key' },
    ], secondary: [
      { to: '/settings', key: 'nav.settings', icon: 'cog' },
      { to: '/settings/plan', key: 'nav.plan', icon: 'metric' },
      { to: '/platform', key: 'nav.platform', icon: 'organization' },
    ] },
  ] },
];

// Drop flagged-off items everywhere (rail, flyouts, palette) and any group left empty.
const keep = (xs?: NavItem[]) => xs?.filter((i) => enabled(i.flag));
// Rail order = Datadog's: clusters separated by a divider, fixed order within.
const ORDER = ['nav.bitsAi', 'nav.dashboards', 'nav.monitoring', 'nav.devPortal', 'nav.incidentResponse', 'nav.automation',
  'nav.infrastructure', 'nav.apm', 'nav.digitalExperience', 'nav.security', 'nav.intelligence',
  'nav.errors', 'nav.metrics', 'nav.production', 'nav.logs', 'nav.admin'];
const rank = (g: NavGroup) => ORDER.indexOf(g.group);
export const NAV: NavGroup[] = [...ALL_NAV].sort((a, b) => rank(a) - rank(b)).map((g) => ({
  ...g,
  items: keep(g.items)!,
  sections: g.sections?.map((s) => ({ ...s, items: keep(s.items)!, secondary: keep(s.secondary), action: enabled(s.action?.flag) ? s.action : undefined })).filter((s) => s.items.length),
})).filter((g) => g.items.length);
