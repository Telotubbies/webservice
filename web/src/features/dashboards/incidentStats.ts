// Incident timing, pure. MTTA/MTTR average only intervals that can exist:
// an acknowledgement or resolution stamped before the incident was created
// is a data error and is left out rather than averaged into a negative time.

export function meanInterval<R extends { created_at: string }>(rows: R[], end: (r: R) => string | null): number | null {
  const ms = rows
    .map((r) => { const e = end(r); return e ? Date.parse(e) - Date.parse(r.created_at) : NaN; })
    .filter((d) => Number.isFinite(d) && d >= 0);
  return ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : null;
}
