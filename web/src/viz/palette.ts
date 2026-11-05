// Series palette and chart theme (spec §7.2).
//
// Five categorical slots in a fixed order — validated with the dataviz
// validator on 2026-10-20 against the light surface #ffffff and the dark
// surface #1b1f26 (lightness band, chroma floor, CVD and normal-vision
// separation, ≥ 3:1 contrast: all pass). Re-run the validator whenever a
// value changes. There is no sixth hue: past five series a chart splits into
// small multiples. Colour follows the entity, never its rank — a series keeps
// its slot while others are hidden, added or reordered. Status colours
// (crit/warn/info/ok) are never series colours.

export const SERIES = {
  light: ['#2a78d6', '#c0479d', '#6250d6', '#0b9a9a', '#9b4fc4'],
  dark: ['#3987e5', '#d55181', '#9085e9', '#13a0a0', '#b06fd8'],
} as const satisfies Record<'light' | 'dark', readonly string[]>;

export const SLOTS = SERIES.light.length;

/** key → slot index. Keys already in `prior` keep their slot; new keys take
 *  the lowest free slot; with all five taken a key gets -1 (the caller
 *  renders small multiples instead of inventing a colour). */
export function assignSeriesColors(keys: string[], prior: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  const used = new Set<number>();
  for (const k of keys) {
    const p = prior.get(k);
    if (p != null && p >= 0 && p < SLOTS && !used.has(p)) { out.set(k, p); used.add(p); }
  }
  for (const k of keys) {
    if (out.has(k)) continue;
    let slot = -1;
    for (let i = 0; i < SLOTS; i++) if (!used.has(i)) { slot = i; break; }
    out.set(k, slot);
    if (slot >= 0) used.add(slot);
  }
  return new Map(keys.map((k) => [k, out.get(k)!]));
}

export interface ChartTheme {
  name: 'light' | 'dark';
  series: readonly string[];
  grid: string;
  axis: string;
  text: string;
  surface: string;
  crit: string;
  warn: string;
  info: string;
}

/** The theme's chart colours, read from CSS tokens (`css` resolves a custom
 *  property — canvas cannot resolve var() itself). */
export function chartTheme(theme: 'light' | 'dark', css: (name: string) => string): ChartTheme {
  return {
    name: theme,
    series: SERIES[theme],
    grid: css('--color-line'),
    axis: css('--color-ink-3'),
    text: css('--color-ink-2'),
    surface: css('--color-panel'),
    crit: css('--color-crit'),
    warn: css('--color-warn-ink'),
    info: css('--color-info'),
  };
}

/** Changes whenever any colour a built chart baked in would change. */
export function chartThemeKey(t: ChartTheme): string {
  return [t.name, t.grid, t.axis, t.text, t.surface, t.crit, t.warn, t.info, ...t.series].join('|');
}

/** A slot's colour in a theme; -1 (no slot) has none. */
export function slotColor(slot: number, theme: 'light' | 'dark'): string | null {
  return slot >= 0 && slot < SLOTS ? SERIES[theme][slot] : null;
}
