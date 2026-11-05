// Field logic, pure. Number input is format-tolerant (Postel's law): spaces
// are dropped, '.' is the decimal point; an empty box is "empty", never 0.

export type NumberParse = { ok: true; value: number } | { ok: false; reason: 'empty' | 'nan' | 'min' | 'max' };

export function parseNumberField(raw: string, o: { min?: number; max?: number; locale?: string }): NumberParse {
  const s = raw.replace(/\s+/g, '');
  if (s === '') return { ok: false, reason: 'empty' };
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return { ok: false, reason: 'nan' };
  const v = Number(s);
  if (o.min != null && v < o.min) return { ok: false, reason: 'min' };
  if (o.max != null && v > o.max) return { ok: false, reason: 'max' };
  return { ok: true, value: v };
}

/** Snap to the step grid (anchored at min, else 0), then clamp; rounds away
 *  binary float noise so 0.1 + 0.2 shows as 0.3. */
export function clampStep(v: number, step: number, min?: number, max?: number): number {
  const base = min ?? 0;
  let out = step > 0 ? base + Math.round((v - base) / step) * step : v;
  if (min != null) out = Math.max(min, out);
  if (max != null) out = Math.min(max, out);
  const dec = Math.max(0, (String(step).split('.')[1] ?? '').length);
  return Number(out.toFixed(Math.min(10, dec + 2)));
}

export interface Option { value: string; label: string; hint?: string }

/** Case-insensitive substring match over label and hint. Locale-aware lower
 *  casing only — no accent folding, so Thai vowels and tone marks are never
 *  stripped (they change meaning). */
export function filterOptions(options: Option[], q: string, locale: string): Option[] {
  const needle = q.trim().toLocaleLowerCase(locale);
  if (!needle) return options;
  return options.filter((o) => `${o.label} ${o.hint ?? ''}`.toLocaleLowerCase(locale).includes(needle));
}
