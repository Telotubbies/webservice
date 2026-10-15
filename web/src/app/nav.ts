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
  action?: { to: string; key: string };
}
export interface NavGroup {
  group: string; icon: DdIconName; items: NavItem[]; gated?: boolean;
  /** flyout anatomy; falls back to one anonymous section of `items` */
  sections?: NavSection[];
  action?: { to: string; key: string };
}

const ALL_NAV: NavGroup[] = [
  // Datadog IA, mapped to plant operations: group by job-to-be-done.
  { group: 'nav.dashboards', icon: 'dashboard', items: [
    { to: '/', key: 'nav.overview', icon: 'home' },
    { to: '/dashboards', key: 'nav.dashboards', icon: 'dashboard', badge: 'new' },
    { to: '/line', key: 'nav.line', icon: 'service-map' },
    { to: '/line3d', key: 'nav.line3d', icon: 'building-block' },
    { to: '/notebooks', key: 'nav.notebooks', icon: 'notebook', flag: 'notebooks' },
  ] },
  { group: 'nav.monitoring', icon: 'monitor', items: [
    { to: '/alarms', key: 'nav.alarms', icon: 'attention-circled' },
    { to: '/downtimes', key: 'nav.downtimes', icon: 'snooze', flag: 'downtimes' },
    { to: '/alarms/quality', key: 'nav.alarmQuality', icon: 'bell-curve' },
    { to: '/slos', key: 'nav.slos', icon: 'status-page' },
    { to: '/events', key: 'nav.events', icon: 'events' },
    { to: '/incidents', key: 'nav.incidents', icon: 'incidents', flag: 'incidents' },
    { to: '/activity', key: 'nav.activity', icon: 'bell' },
  ], sections: [
    { title: 'nav.secAlarms', items: [
      { to: '/alarms', key: 'nav.alarms', icon: 'attention-circled' },
      { to: '/downtimes', key: 'nav.downtimes', icon: 'snooze', flag: 'downtimes' },
      { to: '/alarms/quality', key: 'nav.alarmQuality', icon: 'bell-curve' },
    ], secondary: [
      { to: '/admin/rules', key: 'nav.adminRules', icon: 'assert-list' },
      { to: '/alarms/settings', key: 'nav.alarmSettings', icon: 'cog', flag: 'alarmsettings' },
    ],
      action: { to: '/admin/rules/new', key: 'nav.actionNewRule' } },
    { title: 'nav.secReliability', items: [
      { to: '/slos', key: 'nav.slos', icon: 'status-page' },
      { to: '/activity', key: 'nav.activity', icon: 'bell' },
    ] },
    { title: 'nav.secEvents', items: [
      { to: '/events', key: 'nav.events', icon: 'events' },
      { to: '/incidents', key: 'nav.incidents', icon: 'incidents', flag: 'incidents' },
    ], secondary: [{ to: '/synthetics', key: 'nav.synthetics', icon: 'multi-heartbeat', flag: 'synthetics' }] },
  ] },
  { group: 'nav.infrastructure', icon: 'server', items: [
    { to: '/infrastructure', key: 'nav.devices', icon: 'server', badge: 'new' },
    { to: '/catalog', key: 'nav.catalog', icon: 'books', flag: 'catalog' },
    { to: '/processes', key: 'nav.processes', icon: 'container', flag: 'processes' },
    { to: '/health', key: 'nav.health', icon: 'heartbeat' },
  ], action: { to: '/infrastructure/add', key: 'nav.addDevice' } },
  { group: 'nav.metrics', icon: 'metric', items: [
    { to: '/trends', key: 'nav.trends', icon: 'graph-line' },
    { to: '/metrics', key: 'nav.metricsSummary', icon: 'metric' },
    { to: '/tags', key: 'nav.tags', icon: 'list' },
    { to: '/query', key: 'nav.query', icon: 'database', flag: 'query' },
  ] },
  { group: 'nav.logs', icon: 'log-pipelines', items: [
    { to: '/logs', key: 'nav.logs', icon: 'log-pipelines', flag: 'logs' },
    { to: '/traces', key: 'nav.traces', icon: 'service-map', flag: 'traces' },
    { to: '/sessions', key: 'nav.sessions', icon: 'eye', flag: 'sessions' },
  ] },
  { group: 'nav.errors', icon: 'error-tracking', items: [
    { to: '/errors', key: 'nav.errors', icon: 'error-tracking', flag: 'errors' },
  ] },
  { group: 'nav.automation', icon: 'lightning-filled', items: [
    { to: '/commands', key: 'nav.commands', icon: 'prompt' },
  ] },
  { group: 'nav.intelligence', icon: 'watchdog', items: [
    { to: '/insights', key: 'nav.insights', icon: 'ai-search' },
    { to: '/assistant', key: 'nav.assistant', icon: 'comment', flag: 'assistant' },
  ] },
  // admin: operators+ see it (mutations stay admin|owner server-side)
  { group: 'nav.admin', icon: 'organization', gated: true, items: [
    { to: '/admin', key: 'nav.adminOrg', icon: 'organization' },
    { to: '/admin/rules', key: 'nav.adminRules', icon: 'assert-list' },
    { to: '/admin/users', key: 'nav.adminUsers', icon: 'users' },
    { to: '/teams', key: 'nav.teams', icon: 'on-call', flag: 'teams' },
    { to: '/admin/audit', key: 'nav.adminAudit', icon: 'audit-trail' },
    { to: '/security', key: 'nav.security', icon: 'security-monitoring', flag: 'security' },
  ], sections: [
    { title: 'admin.navOrg', items: [
      { to: '/admin', key: 'nav.adminOrg', icon: 'organization' },
      { to: '/admin/rules', key: 'nav.adminRules', icon: 'assert-list' },
    ] },
    { title: 'admin.navIdentity', items: [
      { to: '/admin/users', key: 'nav.adminUsers', icon: 'users' },
      { to: '/teams', key: 'nav.teams', icon: 'on-call', flag: 'teams' },
    ], action: { to: '/admin/users', key: 'nav.actionInvite' } },
    { title: 'admin.navAccess', items: [
      { to: '/admin/audit', key: 'nav.adminAudit', icon: 'audit-trail' },
      { to: '/security', key: 'nav.security', icon: 'security-monitoring', flag: 'security' },
    ], secondary: [
      { to: '/settings', key: 'nav.settings', icon: 'cog' },
    ] },
  ] },
];

// Drop flagged-off items everywhere (rail, flyouts, palette) and any group left empty.
const keep = (xs?: NavItem[]) => xs?.filter((i) => enabled(i.flag));
export const NAV: NavGroup[] = ALL_NAV.map((g) => ({
  ...g,
  items: keep(g.items)!,
  sections: g.sections?.map((s) => ({ ...s, items: keep(s.items)!, secondary: keep(s.secondary) })).filter((s) => s.items.length),
})).filter((g) => g.items.length);
