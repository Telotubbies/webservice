// Shared nav model (v4 T12) — extracted from Shell.tsx so both the icon rail
// and the command palette consume one source of truth without an import
// cycle (Shell → CommandPalette → nav).

import type { IconName } from '../shared/ui/Icon';

export interface NavItem { to: string; key: string; icon: IconName }
export interface NavGroup { group: string; items: NavItem[]; gated?: boolean }

export const NAV: NavGroup[] = [
  { group: 'nav.monitor', items: [
    { to: '/', key: 'nav.overview', icon: 'overview' },
    { to: '/line', key: 'nav.line', icon: 'line' },
    { to: '/line3d', key: 'nav.line3d', icon: 'line3d' },
    { to: '/trends', key: 'nav.trends', icon: 'trends' },
  ] },
  { group: 'nav.operate', items: [
    { to: '/alarms', key: 'nav.alarms', icon: 'alarm' },
    { to: '/commands', key: 'nav.commands', icon: 'commands' },
  ] },
  { group: 'nav.intelligence', items: [
    { to: '/insights', key: 'nav.insights', icon: 'sparkle' },
  ] },
  { group: 'nav.system', items: [
    { to: '/tags', key: 'nav.tags', icon: 'tags' },
    { to: '/health', key: 'nav.health', icon: 'health' },
  ] },
  // v4 T10: org administration — operators+ see it (mutations stay
  // admin|owner server-side); viewers get no admin nav at all. Never in the
  // mobile bar — MOBILE is unchanged (5-item UAT contract).
  { group: 'nav.admin', gated: true, items: [
    { to: '/admin', key: 'nav.adminOrg', icon: 'shield' },
    { to: '/admin/rules', key: 'nav.adminRules', icon: 'alarm' },
    { to: '/admin/users', key: 'nav.adminUsers', icon: 'user' },
    { to: '/admin/audit', key: 'nav.adminAudit', icon: 'download' },
  ] },
];
