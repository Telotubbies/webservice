// "Is the line running?" — computed from feed state and sample age, never
// asserted. Pure so the ISA-101 rules below are tested without a DOM.

export type Verdict = 'running' | 'stopped' | 'stale' | 'nodata';

/* Running and stopped are both normal plant states (a stop may be planned),
   so both sit on the neutral ground — running reads strongest, stopped gets
   an outline. Only "data not current" is abnormal here; a real fault arrives
   as an alarm with its own priority. */
export const VERDICT_TONE: Record<Verdict, string> = {
  running: 'bg-neutral-soft text-ink',
  stopped: 'border border-line-hard bg-neutral-soft text-ink-68',
  stale: 'bg-[var(--color-caution-soft)] text-[var(--color-caution-ink)]',
  nodata: 'bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)]',
};
export const VERDICT_GLYPH: Record<Verdict, string> = { running: '●', stopped: '■', stale: '◌', nodata: '○' };

/** A dead feed or an old sample is "data not current", never the last value. */
export function lineVerdict(o: { hasSample: boolean; fresh: boolean; wsOpen: boolean; running: boolean }): Verdict {
  if (!o.hasSample) return 'nodata';
  if (!o.wsOpen || !o.fresh) return 'stale';
  return o.running ? 'running' : 'stopped';
}
