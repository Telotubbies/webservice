// Readout (plan §1.2): a dark panel with one mono value, its unit, three
// secondary fields and a range bar with limit marks. Data quality and the
// age of the reading are part of the panel: a stale value never looks live.

import { DdIcon } from './DdIcon';

export interface ReadoutDim { label: string; value: string }

export interface ReadoutProps {
  /** panel title, e.g. "POSITION" */
  label: string;
  value: number;
  unit?: string;
  decimals?: number;
  /** three secondary fields: motor temp, state, updated */
  dims?: ReadoutDim[];
  min: number;
  max: number;
  limits?: { lo?: number; hi?: number };
  /** limit captions, e.g. "LO 5" — caller supplies both languages */
  loText?: string;
  hiText?: string;
  state?: 'live' | 'stale' | 'error';
  /** quality + age line, e.g. "Good · 0.4 s" or "Not current · 2 min" */
  stateLabel: string;
  className?: string;
}

const pct = (v: number, min: number, max: number) =>
  max === min ? 0 : Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));

export function Readout({
  label, value, unit, decimals = 1, dims = [], min, max, limits, loText, hiText,
  state = 'live', stateLabel, className = '',
}: ReadoutProps) {
  const p = pct(value, min, max);
  const band = limits && limits.lo != null && limits.hi != null
    ? { left: pct(limits.lo, min, max), width: Math.max(0, pct(limits.hi, min, max) - pct(limits.lo, min, max)) }
    : null;
  const tone = state === 'error' ? 'text-[var(--color-crit-on-dark)]'
    : state === 'stale' ? 'text-[var(--color-warn-on-dark)]'
      : 'text-[var(--color-readout-dim)]';

  return (
    <section
      data-readout={state}
      aria-label={label}
      className={`min-w-0 rounded-[5px] bg-[var(--color-readout)] p-3 text-[var(--color-readout-ink)] ${className}`}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <h3 className="text-[12px] font-semibold text-[var(--color-readout-dim)]">{label}</h3>
        <span className={`flex items-center gap-1 text-[12px] font-semibold ${tone}`}>
          {state === 'stale' && <DdIcon name="clock" size={12} />}
          {stateLabel}
        </span>
      </header>

      <p className="mt-1 font-mono text-[30px] leading-none tracking-tight">
        {value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
        {unit && <span className="ml-1 text-[13px] font-normal text-[var(--color-readout-dim)]">{unit}</span>}
      </p>

      {dims.length > 0 && (
        <dl className="mt-2 grid grid-cols-3 gap-2">
          {dims.map((d) => (
            <div key={d.label} className="min-w-0">
              <dt className="text-[12px] text-[var(--color-readout-dim)]">{d.label}</dt>
              <dd className="truncate text-[13px] font-semibold" title={d.value}>{d.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-2.5" aria-hidden>
        <div className="relative h-1.5 rounded-full bg-[color-mix(in_srgb,var(--color-readout-ink)_18%,transparent)]">
          {band && <span className="absolute inset-y-0 rounded-full bg-[color-mix(in_srgb,var(--color-readout-ink)_12%,transparent)]" style={{ left: `${band.left}%`, width: `${band.width}%` }} />}
          <span className="absolute inset-y-0 left-0 rounded-full bg-[var(--color-readout-dim)]" style={{ width: `${p}%` }} />
          {limits?.lo != null && <span className="absolute -inset-y-0.5 w-0.5 bg-[var(--color-crit-on-dark)]" style={{ left: `${pct(limits.lo, min, max)}%` }} />}
          {limits?.hi != null && <span className="absolute -inset-y-0.5 w-0.5 bg-[var(--color-crit-on-dark)]" style={{ left: `${pct(limits.hi, min, max)}%` }} />}
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-[var(--color-readout-dim)]">
          <span>{min}</span>
          {loText && <span>{loText}</span>}
          {hiText && <span>{hiText}</span>}
          <span>{max}</span>
        </div>
      </div>
    </section>
  );
}
