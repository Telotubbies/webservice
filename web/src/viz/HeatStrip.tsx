// HeatStrip — event density over time (spec §7.1): equal bins on one
// sequential blue ramp (--color-seq-1..5, light→dark = few→many). Magnitude
// only — status hues are reserved for state, never for "how many". Every bin
// is a button whose name states its window and count; an empty bin stays the
// track colour.

import { useTranslation } from 'react-i18next';
import { binCounts, rampStep } from './heat';
import './i18n';

const STEP = ['bg-panel-2', 'bg-seq-1', 'bg-seq-2', 'bg-seq-3', 'bg-seq-4', 'bg-seq-5'];

export function HeatStrip({ ts, from, to, bins = 48, label, picked, onPick, tip }: {
  ts: number[]; from: number; to: number; bins?: number; label: string;
  /** index of the selected bin, if any */
  picked?: number | null;
  onPick?: (i: number | null) => void;
  /** extra words per bin (e.g. its worst severity) */
  tip?: (i: number) => string;
}) {
  const { t, i18n } = useTranslation();
  const counts = binCounts(ts, from, to, bins);
  const max = Math.max(0, ...counts);
  const w = (to - from) / bins;
  const clock = (ms: number) => new Date(ms).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit', hour12: false });
  return (
    <div role="group" aria-label={label} className="flex h-5 gap-px">
      {counts.map((n, i) => {
        const a = from + i * w;
        const name = `${t('viz2.heatLabel', { count: n, from: clock(a), to: clock(a + w) })}${tip ? ` · ${tip(i)}` : ''}`;
        const on = picked === i;
        return (
          <button
            key={i} type="button" title={name} aria-label={name} aria-pressed={onPick ? on : undefined}
            disabled={!onPick || n === 0}
            onClick={() => onPick?.(on ? null : i)}
            className={`min-w-0 flex-1 rounded-[1px] disabled:cursor-default ${STEP[rampStep(n, max)]} ${on ? 'outline outline-2 outline-offset-1 outline-accent' : ''}`}
          />
        );
      })}
    </div>
  );
}
