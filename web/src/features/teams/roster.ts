// Teams + shift roster store. The backend has no teams/roster table yet, so
// this lives in localStorage — per ORG (key suffix) so two tenants sharing a
// browser never see each other's roster — and every surface that shows it
// says "saved on this device only". Versioned + validated on read.

import { useSyncExternalStore } from 'react';

export interface TeamMember { userId: string | null; name: string }
export interface Team {
  id: string;
  name: string;
  members: TeamMember[];
  /** equipment keys (catalog) this team owns */
  equipment: string[];
}
export interface Shift { id: string; start: string; end: string } // HH:MM, end may wrap past midnight
/** day 0=Mon…6=Sun → shift id → team id */
export type Assignments = Record<string, Record<string, string | null>>;
export interface RosterState { v: 1; teams: Team[]; shifts: Shift[]; assign: Assignments }

/** Three 8-hour shifts — the common pattern on Thai aggregate/cement sites. */
export const DEFAULT_SHIFTS: Shift[] = [
  { id: 'A', start: '06:00', end: '14:00' },
  { id: 'B', start: '14:00', end: '22:00' },
  { id: 'C', start: '22:00', end: '06:00' },
];

const EMPTY: RosterState = { v: 1, teams: [], shifts: DEFAULT_SHIFTS, assign: {} };
const KEY = (org: string) => `wds.roster.v1:${org}`;

const cache = new Map<string, RosterState>();
const listeners = new Set<() => void>();

function read(org: string): RosterState {
  const hit = cache.get(org);
  if (hit) return hit;
  let st = EMPTY;
  try {
    const raw = localStorage.getItem(KEY(org));
    if (raw) {
      const p = JSON.parse(raw) as Partial<RosterState>;
      if (p && p.v === 1 && Array.isArray(p.teams)) {
        st = {
          v: 1,
          teams: p.teams.filter((x) => x && typeof x.id === 'string' && typeof x.name === 'string')
            .map((x) => ({ ...x, members: Array.isArray(x.members) ? x.members : [], equipment: Array.isArray(x.equipment) ? x.equipment : [] })),
          shifts: Array.isArray(p.shifts) && p.shifts.length ? p.shifts : DEFAULT_SHIFTS,
          assign: p.assign && typeof p.assign === 'object' ? p.assign : {},
        };
      }
    }
  } catch { /* unreadable storage → empty roster */ }
  cache.set(org, st);
  return st;
}

function write(org: string, st: RosterState) {
  cache.set(org, st);
  try { localStorage.setItem(KEY(org), JSON.stringify(st)); } catch { /* quota/private mode: keep in memory */ }
  listeners.forEach((fn) => fn());
}

const subscribe = (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); };

export function useRoster(org: string | null): RosterState {
  return useSyncExternalStore(subscribe, () => (org ? read(org) : EMPTY), () => EMPTY);
}

export function updateRoster(org: string, fn: (st: RosterState) => RosterState) {
  write(org, fn(read(org)));
}

export const newId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const mins = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Which shift covers `now`, and which roster day it belongs to (a night
 *  shift that started yesterday belongs to yesterday's column). */
export function currentShift(shifts: Shift[], now: Date): { shift: Shift; day: number } | null {
  const m = now.getHours() * 60 + now.getMinutes();
  const today = (now.getDay() + 6) % 7; // Mon=0
  for (const s of shifts) {
    const a = mins(s.start), b = mins(s.end);
    if (a < b ? m >= a && m < b : m >= a) return { shift: s, day: today };
    if (a >= b && m < b) return { shift: s, day: (today + 6) % 7 };
  }
  return null;
}

export function onCallNow(st: RosterState, now: Date): { shift: Shift; team: Team | null } | null {
  const cur = currentShift(st.shifts, now);
  if (!cur) return null;
  const tid = st.assign[String(cur.day)]?.[cur.shift.id] ?? null;
  return { shift: cur.shift, team: st.teams.find((x) => x.id === tid) ?? null };
}

export function ownerOf(st: RosterState, equipmentKey: string): Team | null {
  return st.teams.find((x) => x.equipment.includes(equipmentKey)) ?? null;
}
