// "Start here" — first pages per job, kept pure so bun tests cover the role
// mapping and the remember-once flags without a DOM. The panel preselects the
// path from the signed-in role (the system knows it, so the user never has to
// say it) and lets anyone switch.

import type { DdIconName } from '../../shared/ui/ddicons';

export type StartPath = 'operator' | 'engineer' | 'admin';
export interface StartStep { to: string; key: string; icon: DdIconName }

export const START_PATHS: Record<StartPath, StartStep[]> = {
  operator: [
    { to: '/overview', key: 'overview', icon: 'home' },
    { to: '/alarms', key: 'alarms', icon: 'attention-circled' },
    { to: '/trends', key: 'trends', icon: 'graph-line' },
  ],
  engineer: [
    { to: '/connect/add', key: 'gateway', icon: 'server' },
    { to: '/setup/tags', key: 'tags', icon: 'list' },
    { to: '/setup/rules/new', key: 'rule', icon: 'assert-list' },
  ],
  admin: [
    { to: '/admin/users', key: 'invite', icon: 'users' },
    { to: '/notifications/channels', key: 'notify', icon: 'bell' },
    { to: '/admin', key: 'org', icon: 'organization' },
  ],
};

/** Signed-in role → the path the panel opens on. Admins and owners set the
 *  workspace up; everyone else starts by watching the plant. */
export function pathFor(role: string): StartPath {
  return role === 'admin' || role === 'owner' ? 'admin' : 'operator';
}

// Per-browser flags. `seen`: the panel already opened itself once, so it
// never interrupts again. `hidden`: the user put the rail button away (the
// user menu brings it back).
export const SEEN_KEY = 'wds.start.seen';
export const HIDDEN_KEY = 'wds.start.hidden';

export function readFlag(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}
export function writeFlag(key: string, on: boolean): void {
  try { if (on) localStorage.setItem(key, '1'); else localStorage.removeItem(key); } catch { /* session-only */ }
}

/** Routes where the panel must never open by itself: the wall display runs
 *  unattended on a TV, the guide is already the help, and the Overview is the
 *  first landing page, which the panel must not cover (the rail button stays). */
export function autoOpenAllowed(pathname: string): boolean {
  return pathname !== '/' && !pathname.startsWith('/overview') && !pathname.startsWith('/wall') && !pathname.startsWith('/guide');
}

/** Window event other surfaces (user menu, guide) fire to open the panel. */
export const OPEN_EVENT = 'wds:start-open';
