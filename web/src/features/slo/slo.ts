// SLO derivations shared by the list page, the detail side panel and the
// dashboard widget. Pure functions so the math is testable and the panel,
// list tiles and widget all read the same numbers.
//
// SLI semantics match the backend (backend/app/api/slos.py): a sample counts
// as good when q === 'good'; correction windows are excluded by timestamp
// (starts_at <= ts <= ends_at). The burndown is rebuilt client-side from raw
// tag history because the status endpoint returns one aggregate per window.

import type { SloCorrection, SloDef, SloStatus } from '../../lib/api';
import { equipmentOf } from '../../lib/plant';
import type { RawPt } from '../query/history';

export type Status = 'breached' | 'warning' | 'ok' | 'nodata';
export const STATUS_ORDER: Status[] = ['breached', 'warning', 'ok', 'nodata'];

/** Redundant coding (ISA-101): shape glyph + token colours, never colour
 *  alone. TILE = soft fill + strong ink; CHIP = pill text; BAR = bar fill. */
export const STATUS_GLYPH: Record<Status, string> = { breached: '▲', warning: '◆', ok: '●', nodata: '○' };
export const STATUS_TILE: Record<Status, string> = {
  breached: 'bg-sev-high-soft text-sev-critical',
  warning: 'bg-sev-medium-soft text-sev-ink',
  ok: 'bg-ok-soft text-ok-ink',
  nodata: 'bg-neutral-soft text-ink-muted',
};
export const STATUS_CHIP: Record<Status, string> = {
  breached: 'bg-sev-high-soft text-sev-critical',
  warning: 'bg-sev-medium-soft text-sev-ink',
  ok: 'bg-ok-soft text-ok-ink',
  nodata: 'bg-neutral-soft text-ink-muted',
};
export const STATUS_BAR: Record<Status, string> = {
  breached: 'bg-[var(--color-sev-high)]',
  warning: 'bg-[var(--color-sev-medium)]',
  ok: 'bg-[var(--color-ok)]',
  nodata: 'bg-[var(--color-line-hard)]',
};

export const sloStatus = (sli: number | null, target: number, warning: number): Status =>
  sli == null ? 'nodata' : sli < target ? 'breached' : sli < warning ? 'warning' : 'ok';

/** Share of the allowed bad fraction still unspent, in percent.
 *  Negative = out of budget (the "−446%" dd shows). */
export function budgetLeftPct(sli: number | null, target: number): number | null {
  if (sli == null || target >= 100) return null;
  return (1 - (100 - sli) / (100 - target)) * 100;
}

export interface SloRow extends SloDef {
  tag: string;
  sli: number | null;
  status: Status;
  budgetLeft: number | null;
  equipment: string;
  excluded: number;
  samples: number;
  coveredS: number;
}

/** Join the SLO definitions with the status aggregate (one row per def,
 *  status missing → sli null → "nodata"). */
export function sloRows(defs: SloDef[], status: SloStatus[] | undefined): SloRow[] {
  const byId = new Map((status ?? []).map((x) => [x.id, x]));
  return defs.map((s) => {
    const st = byId.get(s.id);
    const sli = st?.sli ?? null;
    return {
      ...s,
      tag: s.tag ?? '',
      sli,
      status: sloStatus(sli, s.target, s.warning),
      budgetLeft: budgetLeftPct(sli, s.target),
      equipment: (s.tag && equipmentOf(s.tag)) || 'other',
      excluded: st?.excluded ?? 0,
      samples: st?.samples ?? 0,
      coveredS: st?.covered_s ?? 0,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Omnibar — `state:breached` / `equipment:conveyor` / `signal:temp` /
 * `type:availability` tokens plus free text, ANDed (same grammar as the
 * alarms explorer). Unknown key:value tokens degrade to free text.      */
/* ------------------------------------------------------------------ */

const STATE_ALIAS: Record<string, Status> = {
  breached: 'breached', breach: 'breached', alert: 'breached', violated: 'breached',
  warning: 'warning', warn: 'warning',
  ok: 'ok', healthy: 'ok', good: 'ok',
  nodata: 'nodata', 'no_data': 'nodata', none: 'nodata',
};

export function matchSlo(r: SloRow, query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const free = `${r.name} ${r.tag} ${r.equipment} ${r.description}`.toLowerCase();
  return tokens.every((tok) => {
    const m = tok.match(/^([a-z_]+):(.*)$/);
    if (!m) return free.includes(tok);
    const [, key, val] = m;
    if (key === 'state' || key === 'status') {
      const s = STATE_ALIAS[val] ?? STATE_ALIAS[val.replace('-', '_')];
      return s ? r.status === s : free.includes(tok);
    }
    if (key === 'equipment' || key === 'eq') return r.equipment === val;
    if (key === 'signal' || key === 'tag') return r.tag.toLowerCase().includes(val);
    if (key === 'type') return 'availability'.startsWith(val);
    return free.includes(tok); // unknown key → literal text
  });
}

/* ------------------------------------------------------------------ */
/* Error-budget burndown + burn rate from raw history.                  */
/* ------------------------------------------------------------------ */

export interface BurnBucket {
  t0: number; t1: number;
  /** bad-sample share of counted samples in the bucket; null = no samples */
  badFrac: number | null;
  samples: number;
}

export interface Burndown {
  buckets: BurnBucket[];
  /** cumulative budget remaining % after each bucket that has samples */
  line: { t: number; pct: number }[];
  /** timestamp of the oldest counted sample (retention edge) */
  coveredFrom: number | null;
  totalSamples: number;
}

const inCorrections = (t: number, corr: { a: number; b: number }[]) =>
  corr.some((c) => t >= c.a && t <= c.b);

/**
 * Bucket the window into `n` equal spans, drop samples inside correction
 * windows (same rule as the backend), and accumulate the running error
 * budget: remaining% = (1 − badSoFar / allowed) × 100. Buckets with no
 * counted samples contribute nothing and leave a gap in the line.
 */
export function buildBurndown(
  pts: RawPt[], fromMs: number, toMs: number,
  target: number, corrections: SloCorrection[], nBuckets = 48,
): Burndown {
  const allowed = (100 - target) / 100;
  const corr = corrections
    .map((c) => ({ a: Date.parse(c.starts_at), b: Date.parse(c.ends_at) }))
    .filter((c) => Number.isFinite(c.a) && Number.isFinite(c.b));
  const counted = pts.filter((p) => !inCorrections(p.t, corr));
  const step = Math.max(1, (toMs - fromMs) / nBuckets);
  const buckets: BurnBucket[] = Array.from({ length: nBuckets }, (_, i) => ({
    t0: fromMs + i * step, t1: fromMs + (i + 1) * step, badFrac: null, samples: 0,
  }));
  const bad = new Array<number>(nBuckets).fill(0);
  for (const p of counted) {
    if (p.t < fromMs || p.t > toMs) continue;
    const k = Math.min(nBuckets - 1, Math.floor((p.t - fromMs) / step));
    buckets[k].samples++;
    if (p.q !== 'good') bad[k]++;
  }
  for (let i = 0; i < nBuckets; i++) {
    if (buckets[i].samples > 0) buckets[i].badFrac = bad[i] / buckets[i].samples;
  }
  let cumBad = 0;
  let cumN = 0;
  const line: { t: number; pct: number }[] = [];
  let coveredFrom: number | null = null;
  for (let i = 0; i < nBuckets; i++) {
    const b = buckets[i];
    if (!b.samples) continue;
    if (coveredFrom == null) coveredFrom = b.t0;
    cumBad += bad[i];
    cumN += b.samples;
    const badFrac = cumBad / cumN;
    line.push({ t: b.t1, pct: allowed > 0 ? (1 - badFrac / allowed) * 100 : (cumBad ? -100 : 100) });
  }
  return { buckets, line, coveredFrom, totalSamples: cumN };
}

/** Per-bucket burn rate = bad share ÷ allowed share (1.0 = exhausts the
 *  budget exactly at window end). null when the bucket has no samples. */
export function burnRates(buckets: BurnBucket[], target: number): (number | null)[] {
  const allowed = (100 - target) / 100;
  return buckets.map((b) => (b.badFrac == null ? null : allowed > 0 ? b.badFrac / allowed : (b.badFrac > 0 ? Infinity : 0)));
}
