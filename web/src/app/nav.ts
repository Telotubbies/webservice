// Shared nav model — the single source of truth for the sidebar rail,
// flyouts, and the command palette. Icons are semantic names mapped to
// lucide glyphs (see shared/ui/ddicons.ts).
//
// Information architecture follows the console redesign spec (docs/superpowers/
// specs/2026-10-20-console-redesign-design.md §5.1): plant work owns the top of
// the rail, engineering setup sits under it, and every observability page that
// came from the Datadog reference lives in one Platform group. URLs are
// unchanged — only the grouping moved.

import type { DdIconName } from '../shared/ui/ddicons';

import { enabled } from '../lib/features';

// ── Types ────────────────────────────────────────────────────────────────────

export interface NavItem { to: string; key: string; icon: DdIconName; badge?: 'new'; flag?: string }

/** Flyout sub-section: a bold title (with optional NEW badge), a left column
 *  of items, an optional right column of secondary links, and a blue
 *  "+ action" row. */
export interface NavSection {
  title?: string;            // i18n key; omit for an untitled section.
  badge?: 'new';
  items: NavItem[];
  secondary?: NavItem[];
  action?: { to: string; key: string; flag?: string };
}

export type Cluster = 'plant' | 'engineering' | 'platform' | 'admin';

export interface NavGroup {
  /** Rail cluster — the sidebar draws a label or divider where this changes. */
  cluster: Cluster;
  group: string; icon: DdIconName; items: NavItem[]; gated?: boolean;
  /** Flyout anatomy; falls back to one anonymous section holding `items`. */
  sections?: NavSection[];
  action?: { to: string; key: string };
  /** The group's own landing page — the flyout title links here. */
  href?: string;
}

/** Rail label above each cluster; clusters of one group need none. */
export const CLUSTER_LABEL: Partial<Record<Cluster, string>> = {
  plant: 'nav.grpPlant',
  engineering: 'nav.grpEngineering',
};

// ── Nav data ─────────────────────────────────────────────────────────────────
// Declared in rail order. A group's `items` lists every route it owns (the
// palette and active-group matching read it); `sections` only shapes the flyout.

const MONITORS: NavItem[] = [
  { to: '/monitors', key: 'nav.monitors', icon: 'monitor' },
  { to: '/monitors/templates', key: 'nav.monTemplates', icon: 'books' },
  { to: '/slos', key: 'nav.slos', icon: 'status-page' },
];
const INCIDENTS: NavItem[] = [
  { to: '/incidents', key: 'nav.incidents', icon: 'incidents', flag: 'incidents' },
  { to: '/teams', key: 'nav.teams', icon: 'on-call', flag: 'teams' },
];
const DATA: NavItem[] = [
  { to: '/logs', key: 'nav.logs', icon: 'log-pipelines' },
  { to: '/query', key: 'nav.query', icon: 'database' },
  { to: '/metrics', key: 'nav.metricsSummary', icon: 'metric' },
  { to: '/explore', key: 'nav.explore', icon: 'database' },
  { to: '/integration', key: 'nav.integration', icon: 'database' },
  { to: '/integration/erp', key: 'nav.erpImport', icon: 'database' },
  { to: '/traces', key: 'nav.traces', icon: 'service-map', flag: 'traces' },
  { to: '/processes', key: 'nav.processes', icon: 'container', flag: 'processes' },
];
const EXPERIENCE: NavItem[] = [
  { to: '/sessions', key: 'nav.sessions', icon: 'user', flag: 'sessions' },
  { to: '/synthetics', key: 'nav.synthetics', icon: 'multi-heartbeat', flag: 'synthetics' },
  { to: '/catalog', key: 'nav.catalog', icon: 'books', flag: 'catalog' },
];
const SECURITY: NavItem[] = [
  { to: '/security', key: 'nav.secPosture', icon: 'security-monitoring' },
  { to: '/security/issues', key: 'nav.secIssues', icon: 'attention-circled' },
  { to: '/security/findings', key: 'nav.secFindings', icon: 'list' },
  { to: '/security/api', key: 'nav.secApi', icon: 'signpost' },
  { to: '/security/access', key: 'nav.secAccess', icon: 'key' },
];
const INTELLIGENCE: NavItem[] = [
  { to: '/insights', key: 'nav.insights', icon: 'ai-search' },
  { to: '/errors', key: 'nav.errors', icon: 'error-tracking', flag: 'errors' },
  { to: '/assistant', key: 'nav.assistant', icon: 'comment', flag: 'assistant' },
];

const ALL_NAV: NavGroup[] = [
  // ── Cluster 1 — Plant: what the operator watches and acts on all shift.
  { cluster: 'plant', group: 'nav.plantTwin', icon: 'building-block', items: [
    { to: '/', key: 'nav.plantTwin', icon: 'building-block' },
  ] },
  { cluster: 'plant', group: 'nav.overview', icon: 'home', items: [
    { to: '/overview', key: 'nav.overview', icon: 'home' },
  ] },
  { cluster: 'plant', group: 'nav.live', icon: 'datastreams-monitoring', href: '/live', items: [
    { to: '/live', key: 'nav.line', icon: 'datastreams-monitoring' },
    { to: '/wall', key: 'nav.wall', icon: 'resize-expand' },
    { to: '/commands', key: 'nav.commands', icon: 'prompt' },
  ] },
  { cluster: 'plant', group: 'nav.alarms', icon: 'attention-circled', href: '/alarms', items: [
    { to: '/alarms', key: 'nav.alarms', icon: 'attention-circled' },
    { to: '/alarms/quality', key: 'nav.alarmQuality', icon: 'bell-curve' },
    { to: '/downtimes', key: 'nav.downtimes', icon: 'snooze' },
    { to: '/events', key: 'nav.events', icon: 'events' },
    { to: '/activity', key: 'nav.activity', icon: 'bell' },
  ] },
  { cluster: 'plant', group: 'nav.trends', icon: 'graph-line', items: [
    { to: '/trends', key: 'nav.trends', icon: 'graph-line' },
  ] },
  { cluster: 'plant', group: 'nav.production', icon: 'metric', href: '/production/oee', items: [
    { to: '/production/oee', key: 'nav.oee', icon: 'metric' },
    { to: '/production/stops', key: 'nav.stops', icon: 'pause' },
    { to: '/production/shifts', key: 'nav.shifts', icon: 'clock' },
    { to: '/production/reports', key: 'nav.reports', icon: 'download' },
  ] },
  { cluster: 'plant', group: 'nav.dashboards', icon: 'dashboard', href: '/dashboards', items: [
    { to: '/dashboards', key: 'nav.dashboards', icon: 'dashboard' },
    { to: '/notebooks', key: 'nav.notebooks', icon: 'notebook' },
  ], sections: [
    { items: [{ to: '/dashboards', key: 'nav.dashboards', icon: 'dashboard' }], action: { to: '/dashboards?new=1', key: 'nav.actionNewDashboard' } },
    { items: [{ to: '/notebooks', key: 'nav.notebooks', icon: 'notebook' }], action: { to: '/notebooks?new=1', key: 'nav.actionNewNotebook' } },
  ] },

  // ── Cluster 2 — Engineering: bring gateways, PLCs, the model and vision online.
  { cluster: 'engineering', group: 'nav.plantSetup', icon: 'workflows', href: '/setup/structure', items: [
    { to: '/setup/structure', key: 'nav.structure', icon: 'organization' },
    { to: '/setup/model', key: 'nav.plantMapping', icon: 'integration' },
    { to: '/setup/tags', key: 'nav.tags', icon: 'list' },
    { to: '/setup/rules', key: 'nav.adminRules', icon: 'assert-list' },
    { to: '/notifications/channels', key: 'nav.notifyChannels', icon: 'bell' },
    { to: '/alarms/settings', key: 'nav.alarmSettings', icon: 'cog', flag: 'alarmsettings' },
  ], action: { to: '/setup/rules/new', key: 'nav.actionNewRule' } },
  { cluster: 'engineering', group: 'nav.connectivity', icon: 'server', href: '/connect/gateways', items: [
    { to: '/connect/gateways', key: 'nav.devices', icon: 'server' },
    { to: '/connect/sources', key: 'nav.dataSources', icon: 'database' },
    { to: '/connect', key: 'nav.infraMap', icon: 'service-map' },
    { to: '/connect/profiles', key: 'nav.infraProfiles', icon: 'assert-list' },
    { to: '/connect/health', key: 'nav.health', icon: 'heartbeat' },
  ], action: { to: '/connect/add', key: 'nav.addDevice' } },
  { cluster: 'engineering', group: 'nav.vision', icon: 'eye', href: '/vision/cameras', items: [
    { to: '/vision/cameras', key: 'nav.cameras', icon: 'eye' },
    { to: '/vision/models', key: 'nav.visionModels', icon: 'ai-search' },
    { to: '/vision/rules', key: 'nav.visionRules', icon: 'assert-list' },
    { to: '/vision/events', key: 'nav.visionEvents', icon: 'events' },
  ] },

  // ── Cluster 3 — Platform: the observability depth, one group, one level down.
  { cluster: 'platform', group: 'nav.platformTools', icon: 'cog-multi', href: '/monitors',
    items: [...MONITORS, ...INCIDENTS, ...DATA, ...EXPERIENCE, ...SECURITY, ...INTELLIGENCE],
    sections: [
      { title: 'nav.secMonitors', items: MONITORS, secondary: INCIDENTS },
      { title: 'nav.secData', items: DATA, secondary: EXPERIENCE },
      { title: 'nav.security', items: SECURITY, secondary: INTELLIGENCE },
    ] },

  // ── Cluster 4 — Administration.
  // Admin is visible to operators and above; mutations stay admin|owner server-side.
  { cluster: 'admin', group: 'nav.admin', icon: 'lock', gated: true, href: '/admin', items: [
    { to: '/admin', key: 'nav.adminOrg', icon: 'organization' },
    { to: '/admin/users', key: 'nav.adminUsers', icon: 'users' },
    { to: '/admin/audit', key: 'nav.adminAudit', icon: 'audit-trail' },
    { to: '/admin/keys', key: 'nav.adminKeys', icon: 'key' },
    { to: '/admin/storage', key: 'nav.adminStorage', icon: 'datastores' },
    { to: '/settings', key: 'nav.settings', icon: 'cog' },
    { to: '/settings/plan', key: 'nav.plan', icon: 'graph-explorer' },
    { to: '/platform', key: 'nav.platform', icon: 'network' },
  ], sections: [
    { title: 'admin.navOrg', items: [
      { to: '/admin', key: 'nav.adminOrg', icon: 'organization' },
      { to: '/admin/storage', key: 'nav.adminStorage', icon: 'datastores' },
    ], secondary: [
      { to: '/settings', key: 'nav.settings', icon: 'cog' },
      { to: '/settings/plan', key: 'nav.plan', icon: 'graph-explorer' },
      { to: '/platform', key: 'nav.platform', icon: 'network' },
    ] },
    { title: 'admin.navIdentity', items: [
      { to: '/admin/users', key: 'nav.adminUsers', icon: 'users' },
    ], action: { to: '/admin/users', key: 'nav.actionInvite' } },
    { title: 'admin.navAccess', items: [
      { to: '/admin/audit', key: 'nav.adminAudit', icon: 'audit-trail' },
      { to: '/admin/keys', key: 'nav.adminKeys', icon: 'key' },
    ] },
  ] },
];

// ── Derived export ───────────────────────────────────────────────────────────

// Drop flag-disabled items everywhere (rail, flyouts, palette), then drop
// any group left empty.
const keep = (xs?: NavItem[]) => xs?.filter((i) => enabled(i.flag));

export const NAV: NavGroup[] = ALL_NAV.map((g) => ({
  ...g,
  items: keep(g.items)!,
  sections: g.sections?.map((s) => ({ ...s, items: keep(s.items)!, secondary: keep(s.secondary), action: enabled(s.action?.flag) ? s.action : undefined })).filter((s) => s.items.length),
})).filter((g) => g.items.length);

/** How much of `pathname` an item's route covers (0 = no match). Segment
 *  boundaries only, so /alarms never claims /alarmsx. */
function matchLen(pathname: string, to: string): number {
  if (to === '/') return pathname === '/' ? 1 : 0;
  return pathname === to || pathname.startsWith(`${to}/`) ? to.length : 0;
}

/** The rail group that owns `pathname`: the one with the longest matching
 *  route, so /line3d/map lights Plant setup rather than Live. */
export function activeGroup(pathname: string, groups: NavGroup[] = NAV): string | null {
  let best: string | null = null;
  let len = 0;
  for (const g of groups) {
    for (const i of g.items) {
      const n = matchLen(pathname, i.to);
      if (n > len) { len = n; best = g.group; }
    }
  }
  return best;
}
