// F10: the arithmetic behind the silo comparison. Pure, so every number shown
// on the page can be re-derived from the level series and the two settings.
// Each option returns its formula as data (symbolic + with the numbers put in)
// so the UI prints exactly what was computed, never a number without a recipe.

export interface Pt { t: number; v: number }
export type OptionKey = 'refill_now' | 'refill_later' | 'switch_source';

export const RESERVE_PCT = 10;     // the low-level alarm point; below it a silo counts as empty
export const DEFAULT_LEAD_MIN = 45; // tanker lead time from order to cement in the silo

/** Burn rate in %/h: total drops between consecutive samples / elapsed hours.
 *  Rises (a refill in progress) are ignored, so the rate is use, not net change. */
export function burnRate(pts: Pt[]): number | null {
  if (pts.length < 2) return null;
  let drop = 0;
  for (let i = 1; i < pts.length; i++) drop += Math.max(0, pts[i - 1].v - pts[i].v);
  const hours = (pts[pts.length - 1].t - pts[0].t) / 3.6e6;
  return hours > 0 ? drop / hours : null;
}

export interface Formula { sym: string; num: string }
export interface Cover { key: OptionKey; hours: number | null; ok: boolean; formula: Formula; via?: number }

const f1 = (n: number) => (Math.round(n * 10) / 10).toString();

export interface SiloInput { id: number; level: number; rate: number | null }

/** hours of use left above the reserve at a given draw rate (null = no draw seen) */
const hoursAbove = (level: number, rate: number | null) =>
  rate != null && rate > 0.01 ? Math.max(0, (level - RESERVE_PCT) / rate) : null;

export function compare(target: SiloInput, others: SiloInput[], leadMin: number): Cover[] {
  const lead = leadMin / 60;
  const r = target.rate;
  const L = target.level;
  const out: Cover[] = [];

  // Refill now: order goes in at once; the silo must still be above the reserve when the tanker arrives.
  const atArrival = r != null ? L - r * lead : null;
  out.push({
    key: 'refill_now',
    hours: atArrival != null ? Math.max(0, (atArrival - RESERVE_PCT) / (r as number)) : null,
    ok: atArrival != null ? atArrival >= RESERVE_PCT : L - RESERVE_PCT > 0,
    formula: {
      sym: 'level at arrival = L − r × lead',
      num: r != null ? `${f1(L)} − ${f1(r)} × ${f1(lead)} = ${f1(atArrival as number)} %` : `${f1(L)} %`,
    },
  });

  // Refill later: hours until the reserve is hit, minus the lead time = how long you may still wait.
  const H = hoursAbove(L, r);
  out.push({
    key: 'refill_later',
    hours: H != null ? Math.max(0, H - lead) : null,
    ok: H == null || H - lead > 0,
    formula: {
      sym: 'wait up to = (L − reserve) ÷ r − lead',
      num: H != null ? `(${f1(L)} − ${RESERVE_PCT}) ÷ ${f1(r as number)} − ${f1(lead)} = ${f1(H - lead)} h` : `${f1(L)} %`,
    },
  });

  // Switch source: another silo takes the same draw; cover = what it holds above the reserve ÷ our rate.
  let best: { id: number; h: number; level: number } | null = null;
  if (r != null && r > 0.01) {
    for (const o of others) {
      const h = (o.level - RESERVE_PCT) / r;
      if (!best || h > best.h) best = { id: o.id, h, level: o.level };
    }
  }
  out.push({
    key: 'switch_source',
    hours: best ? Math.max(0, best.h) : null,
    ok: !!best && best.h > lead,
    via: best?.id,
    formula: {
      sym: 'cover = (L_other − reserve) ÷ r',
      num: best ? `(${f1(best.level)} − ${RESERVE_PCT}) ÷ ${f1(r as number)} = ${f1(best.h)} h` : '–',
    },
  });
  return out;
}
