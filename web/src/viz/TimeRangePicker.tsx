// TimeRangePicker — Grafana-style (spec §5.2: lives in the page header of
// analytics pages, not the topbar). Presets are a live window; "Custom"
// takes two local datetimes; Pause freezes the current live window into an
// absolute range so the view stops moving while you read it.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Segmented } from '../shared/ui/Segmented';
import { Popover } from '../ui/Popover';
import { DdIcon } from '../shared/ui/DdIcon';
import { RANGE_PRESETS, presetMs, type RangePreset, type TimeRange } from './range';
import './i18n';

const toLocal = (ms: number) => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};
const fromLocal = (s: string) => new Date(s).getTime();

export function TimeRangePicker({ value, onChange, presets = RANGE_PRESETS }: {
  value: TimeRange; onChange: (r: TimeRange) => void; presets?: readonly RangePreset[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [a, setA] = useState(() => toLocal(value.from));
  const [b, setB] = useState(() => toLocal(value.to));
  const valid = fromLocal(b) > fromLocal(a);
  const btn = 'inline-flex h-7 items-center gap-1.5 rounded-control border border-line-strong bg-panel px-2 text-[12px] text-ink hover:bg-panel-2';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented<string>
        label={t('viz.window')}
        value={value.live ? (value.preset ?? '') : ''}
        onChange={(p) => onChange({ from: Date.now() - presetMs(p as RangePreset), to: Date.now(), live: true, preset: p })}
        options={presets.map((p) => ({ value: p, label: p }))}
      />
      <Popover.Root open={open} onOpenChange={(o) => { if (o) { setA(toLocal(value.from)); setB(toLocal(value.to)); } setOpen(o); }}>
        <Popover.Trigger className={`${btn} ${!value.live ? 'border-accent' : ''}`}>
          <DdIcon name="clock" size={12} />{t('viz2.custom')}
        </Popover.Trigger>
        <Popover.Content label={t('viz2.custom')} className="w-72 p-3">
          <div className="flex flex-col gap-2 p-1 text-[12px]">
            <label className="flex flex-col gap-1">
              <span className="font-semibold text-ink-2">{t('viz2.from')}</span>
              <input type="datetime-local" className="h-8 rounded-control border border-line-strong bg-panel px-2 font-mono" value={a} onChange={(e) => setA(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-semibold text-ink-2">{t('viz2.to')}</span>
              <input type="datetime-local" className="h-8 rounded-control border border-line-strong bg-panel px-2 font-mono" value={b} onChange={(e) => setB(e.target.value)} />
            </label>
            <button type="button" className="btn btn-sm self-end" disabled={!valid}
              onClick={() => { onChange({ from: fromLocal(a), to: fromLocal(b), live: false, preset: null }); setOpen(false); }}>
              {t('viz2.apply')}
            </button>
          </div>
        </Popover.Content>
      </Popover.Root>
      {value.live ? (
        <button type="button" className={btn} onClick={() => onChange({ from: value.from, to: Date.now(), live: false, preset: null })}>
          <DdIcon name="pause" size={12} />{t('viz2.pause')}
        </button>
      ) : (
        <button type="button" className={btn} onClick={() => onChange({ from: Date.now() - 3600_000, to: Date.now(), live: true, preset: '1h' })}>
          <DdIcon name="play" size={12} />{t('viz2.resume')}
        </button>
      )}
    </div>
  );
}
