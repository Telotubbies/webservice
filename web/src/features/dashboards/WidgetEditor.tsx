// Widget editor — "Select your visualization → Graph your data → Display →
// Layout" with a live preview on the left (Datadog widget-editor anatomy).
// Layout size inputs double as the keyboard alternative to drag/resize.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Bell, ChartBarBig, ChartLine, Hash, StickyNote, X, type LucideIcon } from 'lucide-react';
import { api } from '../../lib/api';
import { SIGNALS } from '../../lib/plant';
import { WidgetBody, seriesColor } from './widgets';
import { SERIES_COLORS, type Agg, type RangeKey, type VizKind, type Widget } from './model';

const KINDS: { kind: VizKind; icon: LucideIcon }[] = [
  { kind: 'timeseries', icon: ChartLine },
  { kind: 'value', icon: Hash },
  { kind: 'toplist', icon: ChartBarBig },
  { kind: 'alarms', icon: Bell },
  { kind: 'note', icon: StickyNote },
];
const MAX_SERIES = SERIES_COLORS.length;

const numOrNull = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? null : Number(s));

export function validate(w: Widget): Partial<Record<'tags' | 'thresholds' | 'yaxis' | 'note', string>> {
  const e: Partial<Record<'tags' | 'thresholds' | 'yaxis' | 'note', string>> = {};
  if (w.kind === 'timeseries' && (w.tags.length < 1 || w.tags.length > MAX_SERIES)) e.tags = 'dash.errSeries';
  if (w.kind === 'value' && w.tags.length !== 1) e.tags = 'dash.errOneMetric';
  if (w.warn != null && w.crit != null && w.warn >= w.crit) e.thresholds = 'dash.errThresholds';
  if (w.yMin != null && w.yMax != null && w.yMin >= w.yMax) e.yaxis = 'dash.errYaxis';
  if (w.kind === 'note' && !w.note.trim()) e.note = 'dash.errNote';
  return e;
}

export function WidgetEditor({ initial, range, onSave, onClose }: {
  initial: Widget; range: RangeKey; onSave: (w: Widget) => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  const dlg = useRef<HTMLDialogElement>(null);
  const [w, setW] = useState<Widget>(initial);
  const [tried, setTried] = useState(false);
  const tags = useQuery({ queryKey: ['tags'], queryFn: api.tags, staleTime: 60_000 });
  const set = (p: Partial<Widget>) => setW((cur) => ({ ...cur, ...p }));
  const errs = validate(w);
  const ok = Object.keys(errs).length === 0;
  const usesTags = w.kind === 'timeseries' || w.kind === 'value';

  useEffect(() => { dlg.current?.showModal(); }, []);

  const toggleTag = (tag: string) => set({
    tags: w.kind === 'value' ? [tag]
      : w.tags.includes(tag) ? w.tags.filter((x) => x !== tag) : [...w.tags, tag],
  });

  const field = 'block text-[12px] font-semibold text-ink-68';
  const err = (k: keyof typeof errs) => tried && errs[k] ? <p className="mt-1 text-[11px] text-[var(--color-danger)]" role="alert">{t(errs[k]!)}</p> : null;

  return (
    <dialog ref={dlg} onClose={onClose} aria-labelledby="we-title"
      className="m-auto h-[88vh] w-[min(1200px,94vw)] max-w-none rounded-[6px] border border-line p-0 shadow-pop backdrop:bg-black/40">
      <form className="flex h-full flex-col" onSubmit={(e) => {
        e.preventDefault(); setTried(true);
        if (ok) onSave({ ...w, title: w.title.trim() || autoTitle(w) });
      }}>
        <header className="flex h-12 items-center border-b border-line px-4">
          <h2 id="we-title" className="text-[15px] font-semibold">{t('dash.editWidget')}</h2>
          <span className="flex-1" />
          <button type="button" className="grid h-8 w-8 place-items-center rounded hover:bg-subtle" aria-label={t('common.close')} onClick={() => dlg.current?.close()}><X size={16} /></button>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* live preview */}
          <section className="flex w-[45%] flex-col border-r border-line bg-subtle p-4" aria-label={t('dash.preview')}>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-46">{t('dash.preview')}</p>
            <div className="flex h-[320px] flex-col rounded-[5px] border border-line bg-white">
              <h3 className="flex h-8 shrink-0 items-center border-b border-line px-3 text-[12px] font-semibold">{w.title || autoTitle(w)}</h3>
              <div className="min-h-0 flex-1 p-3">{ok ? <WidgetBody w={w} range={range} /> : <p className="text-[12px] text-ink-46">{t('dash.previewFix')}</p>}</div>
            </div>
          </section>

          <div className="min-w-0 flex-1 space-y-5 overflow-y-auto p-4">
            {/* 1. visualization */}
            <fieldset>
              <legend className="mb-2 text-[13px] font-semibold"><Step n={1} />{t('dash.stepViz')}</legend>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('dash.stepViz')}>
                {KINDS.map(({ kind, icon: Ico }) => (
                  <button key={kind} type="button" role="radio" aria-checked={w.kind === kind}
                    onClick={() => set({ kind, tags: kind === 'value' ? w.tags.slice(0, 1) : w.tags })}
                    className={`flex h-16 w-28 flex-col items-center justify-center gap-1 rounded border text-[12px] focus-visible:outline-2 focus-visible:outline-blue ${
                      w.kind === kind ? 'border-blue bg-info-soft font-semibold text-blue' : 'border-line hover:border-ink-35'}`}>
                    <Ico size={18} aria-hidden /> {t(`dash.kind.${kind}`)}
                  </button>
                ))}
              </div>
            </fieldset>

            {/* 2. data */}
            {w.kind !== 'note' && w.kind !== 'alarms' && (
              <fieldset>
                <legend className="mb-2 text-[13px] font-semibold"><Step n={2} />{t('dash.stepData')}</legend>
                {usesTags && (
                  <>
                    <p className={field}>{w.kind === 'value' ? t('dash.metricOne') : t('dash.metricMany', { max: MAX_SERIES })}</p>
                    <div className="mt-1 grid max-h-44 grid-cols-2 gap-1 overflow-y-auto rounded border border-line p-2">
                      {(tags.data ?? []).map((g) => (
                        <label key={g.name} className="flex items-center gap-2 text-[12px]">
                          <input type={w.kind === 'value' ? 'radio' : 'checkbox'} name="we-tag" checked={w.tags.includes(g.name)} onChange={() => toggleTag(g.name)}
                            disabled={w.kind === 'timeseries' && !w.tags.includes(g.name) && w.tags.length >= MAX_SERIES} />
                          <span className="truncate font-mono">{g.name.split('.').slice(-2).join('.')}</span>
                          {g.unit && <span className="text-ink-46">{g.unit}</span>}
                        </label>
                      ))}
                    </div>
                    {err('tags')}
                  </>
                )}
                <div className="mt-3 grid grid-cols-3 gap-3">
                  {w.kind === 'value' && (
                    <label className={field}>{t('dash.aggregation')}
                      <select className="input mt-1 w-full" value={w.agg} onChange={(e) => set({ agg: e.target.value as Agg })}>
                        {(['last', 'avg', 'min', 'max'] as Agg[]).map((a) => <option key={a} value={a}>{t(`dash.agg.${a}`)}</option>)}
                      </select>
                    </label>
                  )}
                  {w.kind === 'toplist' && (
                    <label className={field}>{t('dash.groupBy')}
                      <select className="input mt-1 w-full" value={w.groupBy} onChange={(e) => set({ groupBy: e.target.value as Widget['groupBy'] })}>
                        <option value="tag">{t('dash.group.tag')}</option>
                        <option value="rule">{t('dash.group.rule')}</option>
                        <option value="severity">{t('dash.group.severity')}</option>
                      </select>
                    </label>
                  )}
                  {usesTags && (
                    <label className={field}>{t('dash.range')}
                      <select className="input mt-1 w-full" value={w.range} onChange={(e) => set({ range: e.target.value as Widget['range'] })}>
                        <option value="inherit">{t('dash.rangeInherit')}</option>
                        {(['15m', '1h', '4h', '24h'] as RangeKey[]).map((r) => <option key={r} value={r}>{t('dash.past', { r })}</option>)}
                      </select>
                    </label>
                  )}
                </div>
              </fieldset>
            )}

            {/* 3. display */}
            <fieldset>
              <legend className="mb-2 text-[13px] font-semibold"><Step n={3} />{t('dash.stepDisplay')}</legend>
              <label className={field}>{t('dash.widgetTitle')}
                <input className="input mt-1 w-full" value={w.title} placeholder={autoTitle(w)} onChange={(e) => set({ title: e.target.value })} />
              </label>
              {w.kind === 'note' && (
                <>
                  <label className={`${field} mt-3`}>{t('dash.noteBody')}
                    <textarea className="input mt-1 h-28 w-full py-1" value={w.note} onChange={(e) => set({ note: e.target.value })} />
                  </label>
                  {err('note')}
                </>
              )}
              {usesTags && (
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <label className={field}>{t('dash.unit')}
                    <input className="input mt-1 w-full" value={w.unit} placeholder={SIGNALS[w.tags[0]]?.unit ?? ''} onChange={(e) => set({ unit: e.target.value })} />
                  </label>
                  <label className={field}>{t('dash.decimals')}
                    <input className="input mt-1 w-full" type="number" min={0} max={4} value={w.decimals} onChange={(e) => set({ decimals: Math.max(0, Math.min(4, Number(e.target.value) || 0)) })} />
                  </label>
                  <span />
                  <label className={field}>{t('dash.warn')}
                    <input className="input mt-1 w-full" type="number" step="any" value={w.warn ?? ''} onChange={(e) => set({ warn: numOrNull(e.target.value) })} />
                  </label>
                  <label className={field}>{t('dash.crit')}
                    <input className="input mt-1 w-full" type="number" step="any" value={w.crit ?? ''} onChange={(e) => set({ crit: numOrNull(e.target.value) })} />
                  </label>
                </div>
              )}
              {err('thresholds')}
              {w.kind === 'timeseries' && (
                <>
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <label className={field}>{t('dash.yMin')}
                      <input className="input mt-1 w-full" type="number" step="any" value={w.yMin ?? ''} placeholder={t('dash.auto')} onChange={(e) => set({ yMin: numOrNull(e.target.value) })} />
                    </label>
                    <label className={field}>{t('dash.yMax')}
                      <input className="input mt-1 w-full" type="number" step="any" value={w.yMax ?? ''} placeholder={t('dash.auto')} onChange={(e) => set({ yMax: numOrNull(e.target.value) })} />
                    </label>
                    <label className={field}>{t('dash.lineWidth')}
                      <select className="input mt-1 w-full" value={w.lineWidth} onChange={(e) => set({ lineWidth: Number(e.target.value) })}>
                        {[1, 1.5, 2, 3].map((n) => <option key={n} value={n}>{n}px</option>)}
                      </select>
                    </label>
                  </div>
                  {err('yaxis')}
                  <label className="mt-3 flex items-center gap-2 text-[13px]">
                    <input type="checkbox" checked={w.legend} onChange={(e) => set({ legend: e.target.checked })} /> {t('dash.legend')}
                  </label>
                  {w.tags.length > 0 && (
                    <div className="mt-3">
                      <p className={field}>{t('dash.seriesColors')}</p>
                      <div className="mt-1 flex flex-wrap gap-3">
                        {w.tags.map((tag, i) => (
                          <label key={tag} className="flex items-center gap-1.5 text-[12px]">
                            <input type="color" className="h-7 w-9 cursor-pointer rounded border border-line" value={seriesColor(w, i)}
                              onChange={(e) => set({ colors: w.colors.map((c, j) => (j === i ? e.target.value : c)) })}
                              aria-label={t('dash.colorFor', { tag: tag.split('.').slice(-2).join('.') })} />
                            <span className="font-mono">{tag.split('.').slice(-2).join('.')}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </fieldset>

            {/* 4. layout — keyboard alternative to drag + resize */}
            <fieldset>
              <legend className="mb-2 text-[13px] font-semibold"><Step n={4} />{t('dash.stepLayout')}</legend>
              <div className="grid grid-cols-3 gap-3">
                <label className={field}>{t('dash.width')}
                  <select className="input mt-1 w-full" value={w.w} onChange={(e) => set({ w: Number(e.target.value) })}>
                    {[2, 3, 4, 6, 8, 9, 12].map((n) => <option key={n} value={n}>{t('dash.cols', { n })}</option>)}
                  </select>
                </label>
                <label className={field}>{t('dash.height')}
                  <select className="input mt-1 w-full" value={w.h} onChange={(e) => set({ h: Number(e.target.value) })}>
                    {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{t('dash.rows', { n })}</option>)}
                  </select>
                </label>
              </div>
            </fieldset>
          </div>
        </div>

        <footer className="flex h-14 items-center justify-end gap-2 border-t border-line px-4">
          {tried && !ok && <span className="mr-auto text-[12px] text-[var(--color-danger)]" role="alert">{t('dash.fixErrors')}</span>}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => dlg.current?.close()}>{t('common.close')}</button>
          <button type="submit" className="btn btn-sm">{t('dash.saveWidget')}</button>
        </footer>
      </form>
    </dialog>
  );
}

function Step({ n }: { n: number }) {
  return <span className="mr-2 inline-grid h-5 w-5 place-items-center rounded-full bg-blue text-[11px] text-white" aria-hidden>{n}</span>;
}

export function autoTitle(w: Widget): string {
  if (w.kind === 'note') return 'Note';
  if (w.kind === 'alarms') return 'Active alarms';
  if (w.kind === 'toplist') return `Alarms by ${w.groupBy}`;
  return w.tags.map((x) => x.split('.').slice(-2).join('.')).join(', ') || 'New widget';
}
