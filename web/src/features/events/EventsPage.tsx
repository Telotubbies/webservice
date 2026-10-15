// Events explorer — every alarm, insight, command and system change in one
// filterable list, with a histogram strip. Data: useEventStream (model.ts).

import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ChevronRight, Download, Search } from 'lucide-react';
import { EmptyState, Notice } from '../../shared/ui/Feedback';
import { Segmented } from '../../shared/ui/Segmented';
import { FacetGroup, ProductHeader, facetOptions, toggleIn } from '../../shared/ui/Product';
import { SeverityBadge } from '../../shared/ui/Status';
import { matchQuery, parseQuery } from '../../lib/query';
import { EQUIPMENT } from '../../lib/plant';
import { GAPS, correlate, isCluster, loadCorr, saveCorr, type CorrBy, type Cluster } from './correlate';
import { EventHistogram, type HistBucket } from './EventHistogram';
import { SOURCES, eventFields, useEventStream, type PlantEvent } from './model';
import { RAIL, SOURCE_KEY, SessionBadge, SourceGlyph, eventTitle, fmtTime, signalLabel } from './ui';
import './i18n';

const RANGES = { '1h': 1, '4h': 4, '8h': 8, '24h': 24, '7d': 168 } as const;
type Range = keyof typeof RANGES;
const PAGE = 100;

const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`;

export function EventsPage() {
  const { t, i18n } = useTranslation();
  const stream = useEventStream();
  const [range, setRange] = useState<Range>('8h');
  const [q, setQ] = useState('');
  const [offSource, setOffSource] = useState<Set<string>>(new Set());
  const [offSev, setOffSev] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<HistBucket | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [corr, setCorr] = useState(loadCorr);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const setCorrPref = (p: Partial<typeof corr>) => setCorr((c) => { const n = { ...c, ...p }; saveCorr(n); return n; });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const to = useMemo(() => Date.now(), [stream.events.length, range]);
  const from = to - RANGES[range] * 3600_000;
  const inRange = useMemo(() => stream.events.filter((e) => e.at >= from && e.at <= to), [stream.events, from, to]);

  const ast = useMemo(() => parseQuery(q), [q]);
  const shown = useMemo(() => inRange
    .filter((e) => !offSource.has(e.source) && !offSev.has(e.severity ?? 'none'))
    .filter((e) => !picked || (e.at >= picked.from && e.at < picked.to))
    .filter((e) => matchQuery(ast, eventFields(e, (tag) => signalLabel(t, tag)))), [inRange, offSource, offSev, picked, ast, t]);

  const items = useMemo(() => (corr.on ? correlate(shown, corr) : shown), [corr, shown]);
  const clusterCount = useMemo(() => items.filter(isCluster).length, [items]);
  const toggleOpen = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const keyLabel = (c: Cluster) => {
    if (corr.by === 'all') return t('evx.corrPlant');
    if (corr.by === 'equipment') { const eq = EQUIPMENT.find((x) => x.id === c.key); return eq ? t(eq.labelKey) : c.key; }
    return signalLabel(t, c.key);
  };

  const row = (e: PlantEvent, nested = false) => (
    <tr key={e.id} className={`h-10 border-b border-line last:border-0 hover:bg-info-soft ${nested ? 'bg-subtle/50' : ''}`}>
      <td className={`w-1 p-0 ${RAIL[e.severity ?? 'none']}`} />
      <td className={`whitespace-nowrap px-3 font-mono text-[12px] text-ink-68 ${nested ? 'pl-8' : ''}`}>{fmtTime(e.at, i18n.language, range === '7d')}</td>
      <td className="px-3"><span className="flex items-center gap-1.5 text-ink-68"><SourceGlyph source={e.source} />{t(SOURCE_KEY[e.source])}</span></td>
      <td className="px-3">
        <span className="flex items-center gap-2">
          {e.severity && <SeverityBadge severity={e.severity} />}
          {e.href ? <Link to={e.href} className="font-medium text-ink hover:text-blue hover:underline">{eventTitle(t, e)}</Link> : eventTitle(t, e)}
          {e.session && <SessionBadge t={t} />}
        </span>
      </td>
      <td className="px-3 text-ink-68">{signalLabel(t, e.tag)}</td>
      <td className="px-3 text-ink-68">{e.actor ?? ''}</td>
    </tr>
  );

  const exportCsv = () => {
    const rows = [['time', 'source', 'event', 'signal', 'by'].join(',')];
    for (const e of shown) rows.push([new Date(e.at).toISOString(), e.source, eventTitle(t, e), e.tag ?? '', e.actor ?? ''].map(csvCell).join(','));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }));
    a.download = `events-${new Date().toISOString().slice(0, 16)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const filtered = q !== '' || offSource.size > 0 || offSev.size > 0 || !!picked;
  const sources = SOURCES.filter((s) => s !== 'command' || stream.commandsVisible);

  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader icon="events" title={t('evx.title')} lede={t('evx.lede')}
        actions={
          <div className="flex items-center gap-2">
            <Segmented value={range} onChange={(r) => { setRange(r); setPicked(null); setLimit(PAGE); }} label={t('evx.range')}
              options={(Object.keys(RANGES) as Range[]).map((r) => ({ value: r, label: t(`evx.r${r}`) }))} />
            <button type="button" className="btn btn-sm btn-ghost" onClick={exportCsv} disabled={shown.length === 0}>
              <Download size={14} aria-hidden /> {t('evx.exportCsv')}
            </button>
          </div>
        } />
      <div className="border-b border-line bg-white px-4 py-2">
        <div className="relative">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-35" aria-hidden />
          <input className="input w-full pl-7" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }}
            placeholder={t('evx.searchPh')} aria-label={t('evx.searchLabel')} />
        </div>
      </div>

      <div className="flex flex-1 gap-4 p-4">
        <aside className="w-[220px] shrink-0 self-start border border-line bg-white" aria-label={t('evx.facets')}>
          <FacetGroup title={t('evx.fSource')} off={offSource} emptyLabel="—" onToggle={(v) => setOffSource((s) => toggleIn(s, v))}
            options={facetOptions(inRange, (e) => e.source, (v) => t(SOURCE_KEY[v as PlantEvent['source']]))
              .concat(sources.filter((s) => !inRange.some((e) => e.source === s)).map((s) => ({ value: s, label: t(SOURCE_KEY[s]), count: 0 })))} />
          <FacetGroup title={t('evx.fSeverity')} off={offSev} emptyLabel="—" onToggle={(v) => setOffSev((s) => toggleIn(s, v))}
            options={facetOptions(inRange, (e) => e.severity ?? 'none', (v) => (v === 'none' ? t('evx.sevNone') : t(`alarms.${v}`, { defaultValue: v })))} />
          {filtered && (
            <button type="button" className="w-full px-3 py-2 text-left text-[12px] text-blue hover:underline"
              onClick={() => { setQ(''); setOffSource(new Set()); setOffSev(new Set()); setPicked(null); }}>
              {t('evx.clearFacets')}
            </button>
          )}
        </aside>

        <section className="flex min-w-0 flex-1 flex-col gap-3">
          {stream.error && (
            <Notice tone="warn">
              {t('common.loadFailed', { defaultValue: 'Could not load events.' })}{' '}
              <button type="button" className="text-blue underline" onClick={stream.retry}>{t('common.retry', { defaultValue: 'Retry' })}</button>
            </Notice>
          )}
          {!stream.alarmTimesKnown && !stream.loading && <Notice tone="info">{t('evx.timesUnknown')}</Notice>}
          <EventHistogram events={inRange} from={from} to={to} picked={picked} onPick={(b) => { setPicked(b); setLimit(PAGE); }} />

          <div className="overflow-x-auto rounded-[5px] border border-line bg-white">
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2 text-[12px] text-ink-68">
              <span>{t('evx.count', { count: shown.length })}{corr.on && clusterCount > 0 ? ` · ${t('evx.clusters', { count: clusterCount })}` : ''}</span>
              {!stream.commandsVisible && <span className="italic">{t('evx.noCommands')}</span>}
              <span className="flex-1" />
              <Segmented value={corr.on ? 'corr' : 'list'} label={t('evx.view')}
                onChange={(v) => { setCorrPref({ on: v === 'corr' }); setLimit(PAGE); }}
                options={[{ value: 'list', label: t('evx.viewList') }, { value: 'corr', label: t('evx.viewCorr') }]} />
              {corr.on && (
                <>
                  <label className="flex items-center gap-1.5">{t('evx.corrBy')}
                    <select className="input h-7 text-[12px]" value={corr.by} onChange={(e) => setCorrPref({ by: e.target.value as CorrBy })}>
                      <option value="equipment">{t('evx.byEquipment')}</option>
                      <option value="signal">{t('evx.bySignal')}</option>
                      <option value="all">{t('evx.byAll')}</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-1.5">{t('evx.corrGap')}
                    <select className="input h-7 text-[12px]" value={corr.gapMin} onChange={(e) => setCorrPref({ gapMin: Number(e.target.value) })}>
                      {GAPS.map((g) => <option key={g} value={g}>{t('evx.gapMin', { count: g })}</option>)}
                    </select>
                  </label>
                </>
              )}
            </div>
            {shown.length === 0 ? (
              <EmptyState title={filtered ? t('evx.emptyFiltered') : t('evx.empty')} body={filtered ? t('evx.emptyFilteredBody') : t('evx.emptyBody')} icon="search" />
            ) : (
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left">
                    <th className="w-1" aria-hidden />
                    {(['colTime', 'colSource', 'colEvent', 'colSignal', 'colBy'] as const).map((c) => (
                      <th key={c} scope="col" className="h-8 px-3 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-68">{t(`evx.${c}`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.slice(0, limit).map((it) => {
                    if (!isCluster(it)) return row(it);
                    const isOpen = open.has(it.id);
                    return (
                      <Fragment key={it.id}>
                        <tr className="h-10 border-b border-line bg-subtle hover:bg-info-soft">
                          <td className={`w-1 p-0 ${RAIL[it.worst ?? 'none']}`} />
                          <td className="whitespace-nowrap px-3 font-mono text-[12px] text-ink-68">{fmtTime(it.to, i18n.language, range === '7d')}</td>
                          <td colSpan={4} className="px-3">
                            <button type="button" aria-expanded={isOpen} onClick={() => toggleOpen(it.id)}
                              className="flex w-full items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-blue">
                              <ChevronRight size={14} aria-hidden className={`shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                              {it.worst && <SeverityBadge severity={it.worst} />}
                              <span className="font-medium">{t('evx.clusterTitle', { count: it.events.length, where: keyLabel(it) })}</span>
                              <span className="text-ink-68">{t('evx.clusterSpan', { min: Math.max(1, Math.round((it.to - it.from) / 60_000)) })}</span>
                              <span className="flex items-center gap-1 text-ink-68">{it.sources.map((s) => <SourceGlyph key={s} source={s} />)}</span>
                            </button>
                          </td>
                        </tr>
                        {isOpen && it.events.map((e) => row(e, true))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
            {items.length > limit && (
              <div className="flex items-center justify-between border-t border-line px-3 py-2 text-[12px] text-ink-68">
                {t('evx.shownOf', { shown: limit, total: items.length })}
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setLimit((n) => n + PAGE)}>{t('evx.showMore')}</button>
              </div>
            )}
          </div>
          <p className="text-[11px] text-ink-46">{t('evx.coverage', { cmd: stream.commandsVisible ? t('evx.coverageCmd') : '' })}</p>
        </section>
      </div>
    </div>
  );
}
