// Toast queue — pure, so ordering, de-duplication and expiry are tested
// without a DOM. Newest on top, at most `max`, one entry per id (a repeat
// replaces its earlier self). A critical toast never times out: something
// that needs a person must not disappear before one has seen it.

export type ToastTone = 'info' | 'ok' | 'warn' | 'crit';
export interface ToastItem { id: string; tone: ToastTone; text: string; ttlMs: number }

export function pushToast(q: ToastItem[], t: ToastItem, max = 4): ToastItem[] {
  return [t, ...q.filter((x) => x.id !== t.id)].slice(0, max);
}

/** `born`: id → time first shown (ms). */
export function expire(q: ToastItem[], now: number, born: Map<string, number>): ToastItem[] {
  return q.filter((x) => x.tone === 'crit' || now - (born.get(x.id) ?? now) < x.ttlMs);
}
