// ISA-95 scope below the org/site: Area › Line. Pure helpers for the topbar
// ScopePicker. The selection itself lives in lib/equipment (one store that
// every EquipmentPicker already follows), encoded as 'area:<id>' / 'line:<id>',
// so picking a line in the topbar narrows every Plant page that reads it.

import type { HArea } from './api';

export interface LineScope { areaId?: string; lineId?: string }
export interface Crumb { label: string; id: string; level: 'area' | 'line' }

export function scopeCrumbs(tree: HArea[], s: LineScope): Crumb[] {
  const area = tree.find((a) => a.id === s.areaId);
  if (!area) return [];
  const out: Crumb[] = [{ label: area.name, id: area.id, level: 'area' }];
  const line = area.lines.find((l) => l.id === s.lineId);
  if (line) out.push({ label: line.name, id: line.id, level: 'line' });
  return out;
}

/** Drop whatever no longer exists: a deleted area clears the scope, a line
 *  that is gone (or now under another area) falls back to its area. */
export function repairScope(tree: HArea[], s: LineScope): LineScope {
  const area = tree.find((a) => a.id === s.areaId);
  if (!area) return {};
  return area.lines.some((l) => l.id === s.lineId) ? { areaId: area.id, lineId: s.lineId } : { areaId: area.id };
}

export function toSelection(s: LineScope): string | null {
  if (s.lineId) return `line:${s.lineId}`;
  if (s.areaId) return `area:${s.areaId}`;
  return null;
}

/** Shared selection → Area › Line. An equipment pick (a bare index) sits
 *  below line level, so the topbar shows no line for it. */
export function fromSelection(tree: HArea[], sel: string | null): LineScope {
  if (!sel) return {};
  if (sel.startsWith('area:')) return { areaId: sel.slice(5) };
  if (sel.startsWith('line:')) {
    const lineId = sel.slice(5);
    const area = tree.find((a) => a.lines.some((l) => l.id === lineId));
    return area ? { areaId: area.id, lineId } : {};
  }
  return {};
}
