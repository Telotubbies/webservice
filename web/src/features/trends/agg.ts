// Long trend windows are answered from the rollup tables (spec 2026-10-19 §6).
// Pure helpers, kept apart from useSeries so they test without React.

/** Raw history is kept for 8 h; anything longer is aggregated. */
export const AGG_AFTER_MS = 8 * 3600e3;
const AGG_POINTS = 600;

/** Bucket size for a window: whole hours once it is >= 1 h (hits the hourly
 *  rollup), whole minutes below that (the minute rollup). */
export function bucketFor(spanMs: number): number {
  const s = Math.max(60, Math.ceil(spanMs / 1000 / AGG_POINTS));
  return s >= 3600 ? Math.ceil(s / 3600) * 3600 : Math.ceil(s / 60) * 60;
}

/** `plant1.sort.line1.motor1.running` -> `sort/line1/motor1/running`. */
export const pathOf = (name: string) => name.split('.').slice(1).join('/');
