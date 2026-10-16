// Per-browser SLO preferences (PARITY 0.3: localStorage holds UI prefs only).
// No org-preferences endpoint exists, so settings-page edits land here and
// are labelled "saved in this browser".

export type SloWindowKey = '7d' | '30d' | '90d';
export const SLO_WINDOWS: Record<SloWindowKey, number> = { '7d': 7, '30d': 30, '90d': 90 };
export const SLO_WINDOW_KEYS = Object.keys(SLO_WINDOWS) as SloWindowKey[];

const WIN_KEY = 'wds.slo.window';
const PRESET_KEY = 'wds.slo.newDefaults';

export function listWindow(): SloWindowKey {
  try {
    const v = localStorage.getItem(WIN_KEY);
    if (v === '7d' || v === '30d' || v === '90d') return v;
  } catch { /* private mode */ }
  return '30d';
}

export function setListWindow(w: SloWindowKey): void {
  try { localStorage.setItem(WIN_KEY, w); } catch { /* private mode */ }
}

export interface SloPreset { target: number | null; warning: number | null }

export function newSloPreset(): SloPreset {
  try {
    const raw = localStorage.getItem(PRESET_KEY);
    if (!raw) return { target: null, warning: null };
    const p = JSON.parse(raw) as SloPreset;
    return {
      target: typeof p.target === 'number' && p.target > 0 && p.target < 100 ? p.target : null,
      warning: typeof p.warning === 'number' && p.warning > 0 && p.warning <= 100 ? p.warning : null,
    };
  } catch { return { target: null, warning: null }; }
}

export function setNewSloPreset(p: SloPreset): void {
  try { localStorage.setItem(PRESET_KEY, JSON.stringify(p)); } catch { /* private mode */ }
}
