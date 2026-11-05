// uPlot plugins for event context on a time series (spec §7.1, M8):
//  - annotationsPlugin: a hairline per event (alarm in its severity colour,
//    command/batch in axis ink) with a tick on the x axis — context, not data.
//  - onsetsPlugin: a small ▼ at the top edge where a value first enters a
//    limit's alarm region (breachOnsets), coloured by the limit's severity.

import type uPlot from 'uplot';
import { breachOnsets, type LimitKind } from './series';

export interface Annotation { t: number; kind: 'alarm' | 'command' | 'batch'; label: string; severity?: 'critical' | 'warning' }
export interface PluginColors { axis: string; crit: string; warn: string }

export function annotationsPlugin(items: Annotation[], c: PluginColors): uPlot.Plugin {
  return {
    hooks: {
      draw: [(u) => {
        if (!items.length) return;
        const ctx = u.ctx;
        const dpr = devicePixelRatio || 1;
        const { left, top, width, height } = u.bbox;
        ctx.save();
        for (const a of items) {
          const x = Math.round(u.valToPos(a.t / 1000, 'x', true));
          if (x < left || x > left + width) continue;
          ctx.strokeStyle = a.kind === 'alarm' ? (a.severity === 'critical' ? c.crit : c.warn) : c.axis;
          ctx.globalAlpha = a.kind === 'alarm' ? 0.9 : 0.6;
          ctx.lineWidth = 1 * dpr;
          ctx.setLineDash(a.kind === 'alarm' ? [] : [2 * dpr, 2 * dpr]);
          ctx.beginPath();
          ctx.moveTo(x + 0.5, top);
          ctx.lineTo(x + 0.5, top + height);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
          ctx.lineWidth = 2 * dpr;
          ctx.beginPath();
          ctx.moveTo(x + 0.5, top + height);
          ctx.lineTo(x + 0.5, top + height + 5 * dpr);
          ctx.stroke();
        }
        ctx.restore();
      }],
    },
  };
}

const LIMIT_KINDS = new Set(['hi', 'hihi', 'lo', 'lolo']);

export function onsetsPlugin(limits: { v: number; kind: string; severity: string }[], c: PluginColors): uPlot.Plugin {
  return {
    hooks: {
      draw: [(u) => {
        const xs = u.data[0] as number[];
        const ys = u.data[1] as (number | null)[] | undefined;
        if (!ys || !limits.length) return;
        const pts = xs.flatMap((t, i) => (ys[i] == null ? [] : [{ t, v: ys[i] as number }]));
        const ctx = u.ctx;
        const dpr = devicePixelRatio || 1;
        const { left, top, width } = u.bbox;
        ctx.save();
        for (const l of limits) {
          if (!LIMIT_KINDS.has(l.kind)) continue;
          ctx.fillStyle = l.severity === 'critical' ? c.crit : c.warn;
          for (const t of breachOnsets(pts, { v: l.v, kind: l.kind as LimitKind })) {
            const x = u.valToPos(t, 'x', true);
            if (x < left || x > left + width) continue;
            const s = 5 * dpr;
            ctx.beginPath();
            ctx.moveTo(x - s, top);
            ctx.lineTo(x + s, top);
            ctx.lineTo(x, top + s * 1.4);
            ctx.closePath();
            ctx.fill();
          }
        }
        ctx.restore();
      }],
    },
  };
}
