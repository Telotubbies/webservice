// uPlot plugin: the min–max band of each rollup bucket and the shaded spans
// where data is bad or missing. Drawn under the grid and lines. `update`
// swaps the shapes and repaints, so new data never rebuilds the plot.

import type uPlot from 'uplot';
import type { BandPoint, Gap } from './shape';

export interface BandState { band: BandPoint[][]; gaps: Gap[]; color: string; bad: string; missing: string; limits: { v: number; color: string }[] }

export function bandPlugin(): { plugin: uPlot.Plugin; update: (s: BandState) => void } {
  let state: BandState = { band: [], gaps: [], color: '#888', bad: 'transparent', missing: 'transparent', limits: [] };
  let plot: uPlot | null = null;
  const plugin: uPlot.Plugin = {
    hooks: {
      init: [(u) => { plot = u; }],
      destroy: [() => { plot = null; }],
      drawClear: [(u) => {
        const { band, gaps, color, bad, missing, limits } = state;
        const ctx = u.ctx;
        const dpr = devicePixelRatio || 1;
        const { left, top, width, height } = u.bbox;
        const X = (t: number) => u.valToPos(t / 1000, 'x', true);
        const Y = (v: number) => u.valToPos(v, 'y', true);
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();
        for (const g of gaps) {
          const x0 = X(g.from); const x1 = X(g.to);
          ctx.fillStyle = g.kind === 'bad' ? bad : missing;
          ctx.fillRect(x0, top, Math.max(1, x1 - x0), height);
          if (g.kind === 'bad') { // hatch, so bad is not told from missing by colour alone
            ctx.strokeStyle = color; ctx.globalAlpha = 0.35; ctx.lineWidth = dpr;
            ctx.beginPath();
            for (let x = x0 - height; x < x1; x += 6 * dpr) { ctx.moveTo(x, top + height); ctx.lineTo(x + height, top); }
            ctx.save(); ctx.clip(new Path2D(`M${x0} ${top}H${x1}V${top + height}H${x0}Z`)); ctx.stroke(); ctx.restore();
            ctx.globalAlpha = 1;
          }
        }
        const trace = (run: BandPoint[]) => {
          ctx.beginPath();
          if (run.length === 1) { // one bucket: a 3 px column
            const p = run[0];
            ctx.rect(X(p.t) - 1.5 * dpr, Y(p.mx), 3 * dpr, Math.max(dpr, Y(p.mn) - Y(p.mx)));
            return;
          }
          run.forEach((p, i) => (i ? ctx.lineTo(X(p.t), Y(p.mx)) : ctx.moveTo(X(p.t), Y(p.mx))));
          for (let i = run.length - 1; i >= 0; i--) ctx.lineTo(X(run[i].t), Y(run[i].mn));
          ctx.closePath();
        };
        for (const run of band) {
          ctx.fillStyle = color;
          ctx.globalAlpha = run.length === 1 ? 0.55 : 0.3;
          trace(run); ctx.fill();
          // the part of the band beyond a limit takes the limit's colour, strongly
          for (const l of limits) {
            const yl = Y(l.v);
            ctx.save();
            ctx.beginPath(); ctx.rect(left, top, width, yl - top); ctx.clip();
            ctx.fillStyle = l.color; ctx.globalAlpha = 0.75;
            trace(run); ctx.fill();
            ctx.restore();
          }
          // max envelope: a spike averaged out of the line still has an outline
          if (run.length > 1) {
            ctx.globalAlpha = 0.7; ctx.strokeStyle = color; ctx.lineWidth = 1.25 * dpr;
            ctx.beginPath();
            run.forEach((p, i) => (i ? ctx.lineTo(X(p.t), Y(p.mx)) : ctx.moveTo(X(p.t), Y(p.mx))));
            ctx.stroke();
          }
        }
        ctx.restore();
      }],
    },
  };
  return { plugin, update: (next) => { state = next; plot?.redraw(false); } };
}
