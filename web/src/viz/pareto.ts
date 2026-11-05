// Pareto ordering, pure: largest first with the running share, and a long
// tail folded into one row the caller has already translated.

export function pareto(items: { label: string; value: number }[], top: number, otherLabel: string): { label: string; value: number; cumPct: number }[] {
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, top);
  const tail = sorted.slice(top);
  const rows = tail.length ? [...head, { label: otherLabel, value: tail.reduce((s, x) => s + x.value, 0) }] : head;
  const total = rows.reduce((s, x) => s + x.value, 0);
  let acc = 0;
  return rows.map((r) => {
    acc += r.value;
    return { label: r.label, value: r.value, cumPct: total > 0 ? Math.round((acc / total) * 1000) / 10 : 0 };
  });
}
