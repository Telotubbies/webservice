// Trends — multi-tag uPlot over live ring buffers. Tag picker left, chart
// right; buffers snapshotted on each live flush (rAF-paced by the store).

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { live } from '../../lib/live';
import { useStore } from '../../lib/hooks';
import { SIGNALS, T, unitOf } from '../../lib/plant';
import { PageBar, Card } from '../../shared/ui/Page';
import { Icon } from '../../shared/ui/Icon';
import { Segmented } from '../../shared/ui/Segmented';
import { EmptyState } from '../../shared/ui/Feedback';

const COLORS = ['#006bc2', '#c159ff', '#1c9a67', '#f99d02', '#d24f57', '#5e6dd6'];
const MAX_SERIES = COLORS.length;
const PICKABLE = Object.keys(SIGNALS).filter((k) => k !== T.running);

/** Join tag buffers onto a shared time grid (sorted union, nearest-value). */
function joinBuffers(tags: string[]): [number[], ...number[][]] {
  const bufs = tags.map((t) => live.buffers.get(t) ?? []);
  const times = [...new Set(bufs.flatMap((b) => b.map((p) => p.t)))].sort((a, b) => a - b);
  const series = bufs.map((buf) => {
    let j = 0;
    return times.map((t) => {
      while (j + 1 < buf.length && buf[j + 1].t <= t) j++;
      // only emit when the point is reasonably close to the grid time —
      // keeps gaps honest instead of flat-lining across outages
      const best = Math.abs((buf[j]?.t ?? 0) - t) <= 2000 ? buf[j] : undefined;
      return best ? best.v : (NaN as unknown as number);
    });
  });
  return [times.map((t) => t / 1000), ...series];
}

function Chart({ tags, height = 420, legend = true }: { tags: string[]; height?: number; legend?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const ver = useStore(() => live.version);
  const { i18n } = useTranslation();

  useEffect(() => {
    if (!ref.current) return;
    plot.current?.destroy();
    const data = joinBuffers(tags) as uPlot.AlignedData;
    plot.current = new uPlot({
      width: ref.current.clientWidth,
      height,
      legend: { live: legend },
      cursor: { drag: { x: true, y: false } },
      scales: { x: { time: true } },
      axes: [
        { stroke: '#5d6670', grid: { stroke: '#eef1f4' }, ticks: { stroke: '#e2e5ed' }, font: '11px "Roboto Mono"' },
        { stroke: '#5d6670', grid: { stroke: '#eef1f4' }, ticks: { stroke: '#e2e5ed' }, font: '11px "Roboto Mono"' },
      ],
      series: [
        {},
        ...tags.map((tag, i) => ({
          label: SIGNALS[tag] ? tag.split('.').slice(-2).join('.') : tag,
          stroke: COLORS[i % COLORS.length],
          width: 1.5,
          spanGaps: false,
        })),
      ],
    }, data, ref.current);
    const ro = new ResizeObserver(() => {
      plot.current?.setSize({ width: ref.current!.clientWidth, height });
    });
    ro.observe(ref.current);
    return () => { ro.disconnect(); plot.current?.destroy(); plot.current = null; };
    // rebuild when the tag selection changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tags, i18n.language, height]);

  // push fresh data on each live flush without rebuilding the chart
  useEffect(() => {
    plot.current?.setData(joinBuffers(tags) as uPlot.AlignedData);
  }, [ver, tags]);

  return <div ref={ref} />;
}

export function TrendsPage() {
  const { t } = useTranslation();
  const [sel, setSel] = useState<string[]>([T.beltSpeed, T.beltTemp]);
  const [fq, setFq] = useState('');
  const [mode, setMode] = useState<'explorer' | 'grid'>('explorer');

  const toggle = (tag: string) =>
    setSel((s) => (s.includes(tag) ? s.filter((x) => x !== tag) : [...s, tag].slice(-MAX_SERIES)));

  const metaRows = useMemo(() => PICKABLE.map((tag) => ({ tag, meta: SIGNALS[tag] })), []);

  return (
    <>
      <PageBar title={t('nav.trends')} lede={t('trends.lede')} actions={
        <Segmented
          value={mode}
          onChange={setMode}
          label={t('trends.mode')}
          options={[
            { value: 'explorer', label: t('trends.explorer') },
            { value: 'grid', label: t('trends.grid') },
          ]}
        />
      } />
      {mode === 'grid' ? (
        /* dd dashboard widget grid — one card per signal */
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
          {PICKABLE.map((tag) => (
            <Card key={tag} pad={false}>
              <div className="border-b border-line px-3 py-1.5">
                <p className="text-[13px] font-medium">{t(SIGNALS[tag].labelKey)}</p>
                <p className="font-mono text-[10px] text-ink-46">{tag}{unitOf(tag) ? ` · ${unitOf(tag)}` : ''}</p>
              </div>
              <div className="p-1"><Chart tags={[tag]} height={160} legend={false} /></div>
            </Card>
          ))}
        </div>
      ) : (
      <div className="grid gap-3 p-4 lg:grid-cols-[220px_1fr]">
        <Card title={t('palette.signals')} pad={false}>
          <div className="border-b border-line p-2">
            <div className="relative">
              <Icon name="search" size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-35" />
              <input
                className="input h-7 w-full pl-6 text-[12px]"
                placeholder={t('trends.searchFacets')}
                aria-label={t('trends.searchFacets')}
                value={fq}
                onChange={(e) => setFq(e.target.value)}
              />
            </div>
          </div>
          <ul className="flex flex-col gap-0.5 p-2" aria-label={t('trends.facets')}>
            {metaRows.filter(({ tag, meta }) => !fq || tag.includes(fq) || t(meta.labelKey).toLowerCase().includes(fq.toLowerCase())).map(({ tag, meta }) => (
              <li key={tag}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-subtle has-[:focus-visible]:bg-subtle">
                  <input
                    type="checkbox"
                    checked={sel.includes(tag)}
                    onChange={() => toggle(tag)}
                    aria-label={t(meta.labelKey)}
                    className="accent-blue"
                  />
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: sel.includes(tag) ? COLORS[sel.indexOf(tag) % COLORS.length] : '#c8cdd5' }}
                  />
                  <span className="min-w-0 flex-1 truncate">{t(meta.labelKey)}</span>
                  <span className="text-[10px] text-ink-46">{unitOf(tag) ?? ''}</span>
                </label>
              </li>
            ))}
          </ul>
          <p className="border-t border-line p-2 text-[10px] text-ink-46"><Icon name="info" size={10} /> {t('trends.max', { count: MAX_SERIES })}</p>
        </Card>
        <Card title={sel.map((s) => s.split('.').slice(-1)[0]).join(' · ') || t('nav.trends')} pad={false}>
          <div className="p-2">{sel.length ? <Chart tags={sel} /> : <EmptyState title={t('trends.none')} icon="trends" />}</div>
        </Card>
      </div>
      )}
    </>
  );
}
