// StateTimeline — machine state per equipment over a window (spec §7.1).
// Process-register colours: running is the darker neutral, stopped the light
// neutral (never green/red — ISA-101), fault is the only colour (crit + a
// hatch, so it reads in greyscale), no data is a dashed outline. Each row is
// summarised in text (share of each state); hovering a bar shows its span.

import { useTranslation } from 'react-i18next';
import type { RunSeg, RunState } from './timeline';
import './i18n';

const FILL: Record<RunState, string> = {
  running: 'bg-hmi-equip-run',
  stopped: 'bg-hmi-equip',
  fault: 'bg-crit bg-[repeating-linear-gradient(135deg,transparent_0_3px,rgb(255_255_255/.35)_3px_5px)]',
  nodata: 'border border-dashed border-line-strong bg-transparent',
};

function dur(ms: number): string {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function StateTimeline({ rows, from, to, onPick }: {
  rows: { label: string; segs: RunSeg[] }[]; from: number; to: number; onPick?: (t: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const span = Math.max(1, to - from);
  const clock = (ms: number) => new Date(ms).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit', hour12: false });
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r) => {
        const share = (s: RunState) => Math.round((r.segs.filter((x) => x.state === s).reduce((a, x) => a + (x.to - x.from), 0) / span) * 100);
        const summary = `${r.label}: ${(['running', 'stopped', 'fault', 'nodata'] as const).filter((s) => share(s) > 0).map((s) => `${t(`viz2.${s}`)} ${share(s)}%`).join(', ')}`;
        return (
          <div key={r.label} className="flex items-center gap-2">
            <span className="w-[140px] shrink-0 truncate text-[12px] text-ink-2" title={r.label}>{r.label}</span>
            <div
              role="img" aria-label={summary}
              className={`relative h-4 min-w-0 flex-1 overflow-hidden rounded-[3px] bg-panel-2 ${onPick ? 'cursor-crosshair' : ''}`}
              onClick={onPick ? (e) => {
                const b = e.currentTarget.getBoundingClientRect();
                onPick(from + ((e.clientX - b.left) / b.width) * span);
              } : undefined}
            >
              {r.segs.map((s, i) => (
                <span
                  key={i}
                  className={`absolute inset-y-0 ${FILL[s.state]}`}
                  style={{ left: `${((s.from - from) / span) * 100}%`, width: `${Math.max(0.2, ((s.to - s.from) / span) * 100)}%` }}
                  title={`${t(`viz2.${s.state}`)} · ${t('viz2.duration', { from: clock(s.from), to: clock(s.to), d: dur(s.to - s.from) })}`}
                />
              ))}
            </div>
          </div>
        );
      })}
      <div className="ml-[148px] flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-2" aria-hidden>
        {(['running', 'stopped', 'fault', 'nodata'] as const).map((s) => (
          <span key={s} className="flex items-center gap-1"><span className={`inline-block h-2.5 w-4 rounded-[2px] ${FILL[s]}`} />{t(`viz2.${s}`)}</span>
        ))}
      </div>
    </div>
  );
}
