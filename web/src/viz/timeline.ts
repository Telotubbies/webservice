// Machine-state timeline segments, pure (spec §7.1 StateTimeline). A run
// signal (v > 0 = running) becomes contiguous bars over [from, to): silence
// longer than `staleMs` is "nodata" (never extended as the last state), and
// a bar that contains a fault timestamp becomes "fault".

export type RunState = 'running' | 'stopped' | 'fault' | 'nodata';
export type RunSeg = { from: number; to: number; state: RunState };

export function segments(pts: { t: number; v: number }[], from: number, to: number, faultAt: number[] = [], staleMs = 15_000): RunSeg[] {
  const raw: RunSeg[] = [];
  const push = (a: number, b: number, state: RunState) => { if (b > a) raw.push({ from: a, to: b, state }); };
  const sorted = [...pts].sort((a, b) => a.t - b.t);
  // the last sample at or before `from` sets the state at the window start
  let start = 0;
  for (let i = 0; i < sorted.length; i++) if (sorted[i].t <= from) start = i;
  const inWin = sorted.slice(start).filter((p, i) => i === 0 || p.t < to);
  if (!inWin.length || inWin[0].t >= to) { push(from, to, 'nodata'); return raw; }
  if (inWin[0].t > from) push(from, inWin[0].t, 'nodata');
  inWin.forEach((p, i) => {
    const a = Math.max(p.t, from);
    const next = i + 1 < inWin.length ? inWin[i + 1].t : to;
    const b = Math.min(next, to);
    const live = Math.min(b, p.t + staleMs);
    const state: RunState = p.v > 0 ? 'running' : 'stopped';
    const faulty = faultAt.some((f) => f >= a && f < live);
    push(a, live, faulty ? 'fault' : state);
    push(live, b, 'nodata');
  });
  // merge neighbours in the same state
  const out: RunSeg[] = [];
  for (const s of raw) {
    const last = out[out.length - 1];
    if (last && last.state === s.state && last.to === s.from) last.to = s.to;
    else out.push({ ...s });
  }
  return out;
}
