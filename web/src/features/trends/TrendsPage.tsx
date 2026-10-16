// Trends — the technician's diagnosis surface. Signal picker left; charts
// right, one chart per engineering unit (never a second y-axis) with a
// shared crosshair; full-resolution stats table under them. Everything that
// defines the view lives in the URL so alarm → tag → trend pivots land on
// the same picture:  ?tags=a,b  &w=15m|1h|4h|8h  (&from=&to= epoch ms,
// &f=<expr> per derived series).
// Drag across a chart to zoom — the zoom becomes a from/to window.
//
// WP-B additions: browser-side formula series (`a+b`, `abs(a-60)` …),
// Bars/Lines display, per-series palette picker, Sum in the stats table and
// an "add to dashboard" handoff. Formulas are evaluated over the fetched
// samples and labelled as calculated in the browser — never stored.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { live, STALE_MS } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { SIGNALS, T, displayNumber, shortName, unitOf } from '../../lib/plant';
import { downloadCsv } from '../../lib/csv';
import { PageBar, Card } from '../../shared/ui/Page';
import { Icon } from '../../shared/ui/Icon';
import { Segmented } from '../../shared/ui/Segmented';
import { Dropdown } from '../../shared/ui/Dropdown';
import { EmptyState, Notice } from '../../shared/ui/Feedback';
import { QualityMark } from '../../shared/ui/Status';
import { useAdminOrg } from '../admin/admin';
import { TimeChart } from './TimeChart';
import { statsOf, useSeries, type TagSeries } from './useSeries';
import { MAX_SERIES, SERIES_PALETTE, fmtNum, fmtRange, useLimits, type Pt } from './viz';
import { WINDOWS, type WindowKey } from './links';
import { evalFormula, parseFormula, type FormulaError } from './formula';
import { addTrendWidget, useDashboardTargets } from './addToDashboard';

const DEFAULT_TAGS = [T.beltSpeed, T.beltTemp];
const PICKABLE = Object.keys(SIGNALS).filter((k) => k !== T.running);

const labelOf = (tag: string, t: (k: string) => string) => (SIGNALS[tag] ? t(SIGNALS[tag].labelKey) : shortName(tag));
const decimalsOf = (tag: string) => SIGNALS[tag]?.decimals;

/** Scale stored engineering values for display (ratio → %), same as tiles. */
const scalePts = (tag: string, pts: Pt[]): Pt[] =>
  (displayNumber(tag, 1) === 1 ? pts : pts.map((p) => ({ t: p.t, v: displayNumber(tag, p.v) })));
const scaleV = (tag: string, v: number | null) => (v == null ? null : displayNumber(tag, v));
const letter = (i: number) => String.fromCharCode(97 + i);

/** Colour follows the entity: a tag keeps its slot while selected, so
 *  removing one signal never repaints the survivors. */
function useSlots(sel: string[]): Map<string, number> {
  const slots = useRef(new Map<string, number>());
  const m = slots.current;
  for (const k of [...m.keys()]) if (!sel.includes(k)) m.delete(k);
  for (const tag of sel) {
    if (m.has(tag)) continue;
    const used = new Set(m.values());
    let s = 0;
    while (used.has(s)) s++;
    m.set(tag, s);
  }
  return m;
}

interface FormulaRow {
  src: string;
  ok: boolean;
  err?: FormulaError;
  pts: Pt[];
  step: number;
  dropped: number;
  stats: ReturnType<typeof statsOf>;
}

export function TrendsPage() {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tagRev = useStore(() => live.tagRev);
  const [fq, setFq] = useState('');
  const [mode, setMode] = useState<'explorer' | 'grid'>('explorer');
  const [bars, setBars] = useState(false);
  const [pal, setPal] = useState<Record<string, string>>({});
  const { orgId, orgRole } = useAdminOrg();
  // same write gate as DashboardsPage: viewers keep a local-only board copy
  const canWrite = orgRole !== null && orgRole !== 'viewer';

  const sel = useMemo(() => {
    const raw = params.get('tags');
    const list = raw == null ? DEFAULT_TAGS : raw.split(',').filter(Boolean);
    return [...new Set(list)].slice(0, MAX_SERIES);
  }, [params]);
  const formulas = useMemo(() => params.getAll('f').filter(Boolean), [params]);
  const wParam = params.get('w') ?? '';
  const w: WindowKey = wParam in WINDOWS ? (wParam as WindowKey) : '1h';
  const fromP = Number(params.get('from'));
  const toP = Number(params.get('to'));
  const fixed = Number.isFinite(fromP) && Number.isFinite(toP) && fromP > 0 && toP > fromP;
  const win = fixed ? { fromMs: fromP, toMs: toP, spanMs: toP - fromP } : { fromMs: 0, toMs: null, spanMs: WINDOWS[w] };

  const patch = (p: Record<string, string | null>) => setParams((prev) => {
    const n = new URLSearchParams(prev);
    for (const [k, v] of Object.entries(p)) { if (v == null) n.delete(k); else n.set(k, v); }
    return n;
  }, { replace: true });

  const setFormulas = (list: string[]) => setParams((prev) => {
    const n = new URLSearchParams(prev);
    n.delete('f');
    for (const f of list) n.append('f', f);
    return n;
  }, { replace: true });

  const toggle = (tag: string) => {
    const next = sel.includes(tag) ? sel.filter((x) => x !== tag) : [...sel, tag].slice(-MAX_SERIES);
    patch({ tags: next.join(',') });
  };

  const slots = useSlots(sel);
  // palette overrides sit on top of the slot colours (ISA-101 palette only)
  const colorOf = (tag: string) => pal[tag] ?? SERIES_PALETTE[slots.get(tag) ?? 0];
  const fColorOf = (i: number) => pal[`f:${i}`] ?? SERIES_PALETTE[(sel.length + i) % MAX_SERIES];
  const limits = useLimits();
  const data = useSeries(sel, win);

  // picker rows: every known tag; plant-model signals first
  const rows = useMemo(() => {
    void tagRev;
    const names = live.tags.length ? live.tags.map((x) => x.name) : PICKABLE;
    const known = names.filter((n) => SIGNALS[n] && n !== T.running);
    const rest = names.filter((n) => !SIGNALS[n] || n === T.running).sort();
    return [...known, ...rest];
  }, [tagRev]);
  const unitFor = (tag: string) => unitOf(tag, live.tags.find((x) => x.name === tag)?.unit) ?? '';

  // one chart per unit — small multiples instead of a dual axis
  const groups = new Map<string, TagSeries[]>();
  for (const s of data.series) {
    const u = unitFor(s.tag);
    groups.set(u, [...(groups.get(u) ?? []), s]);
  }

  // derived series — evaluated on full-resolution (undecimated) samples
  const fRows: FormulaRow[] = useMemo(() => formulas.map((src) => {
    const p = parseFormula(src);
    if (!p.ok) return { src, ok: false, err: p.err, pts: [], step: 0, dropped: 0, stats: statsOf([]) };
    const inputs = sel.map((tag) => data.series.find((s) => s.tag === tag)?.raw);
    const r = evalFormula(p.ast, inputs);
    return { src, ok: true, pts: r.pts, step: r.step, dropped: r.dropped, stats: statsOf(r.pts) };
  }), [formulas, sel, data.series]);
  const fDropped = fRows.reduce((a, f) => a + f.dropped, 0);
  const fAnyData = fRows.some((f) => f.pts.length > 0);

  const badCount = data.series.reduce((a, s) => a + s.bad, 0);
  const onZoom = (a: number, b: number) => patch({ from: String(a), to: String(b) });

  const exportCsv = () => {
    const out: Record<string, unknown>[] = [];
    for (const s of data.series) {
      for (const p of s.raw) out.push({ ts: new Date(p.t).toISOString(), tag: s.tag, v: scaleV(s.tag, p.v), unit: unitFor(s.tag) });
    }
    fRows.forEach((f, i) => {
      if (!f.ok) return;
      for (const p of f.pts) out.push({ ts: new Date(p.t).toISOString(), tag: `f${i + 1}: ${f.src}`, v: p.v, unit: '' });
    });
    downloadCsv(`trend-${new Date().toISOString().slice(0, 16)}.csv`,
      [{ key: 'ts', label: 'ts' }, { key: 'tag', label: 'tag' }, { key: 'v', label: 'value' }, { key: 'unit', label: 'unit' }], out);
  };

  const [dashMsg, setDashMsg] = useState<string | null>(null);

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
        /* one card per plant signal, live 15 min */
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
          {PICKABLE.map((tag) => <GridCard key={tag} tag={tag} />)}
        </div>
      ) : (
      <div className="grid gap-3 p-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <Card title={t('viz.signalsPanel')} pad={false}>
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
          <ul className="flex max-h-[240px] flex-col gap-0.5 overflow-y-auto p-2 lg:max-h-[60vh]" aria-label={t('trends.facets')}>
            {rows.filter((tag) => !fq || tag.toLowerCase().includes(fq.toLowerCase()) || labelOf(tag, t).toLowerCase().includes(fq.toLowerCase())).map((tag) => {
              const on = sel.includes(tag);
              return (
                <li key={tag}>
                  <label className="flex min-h-8 cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-subtle has-[:focus-visible]:bg-subtle">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(tag)}
                      disabled={!on && sel.length >= MAX_SERIES}
                      className="accent-blue"
                    />
                    <span className="h-[3px] w-3 shrink-0 rounded-full" style={{ background: on ? colorOf(tag) : '#c8cdd5' }} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{labelOf(tag, t)}</span>
                      {!SIGNALS[tag] && <span className="block truncate font-mono text-[10px] text-ink-46">{tag}</span>}
                    </span>
                    <span className="font-mono text-[10px] text-ink-46">{on ? `${letter(sel.indexOf(tag))} ` : ''}{unitFor(tag)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="border-t border-line p-2 text-[11px] text-ink-46"><Icon name="info" size={10} /> {t('viz.limitCount', { count: MAX_SERIES })} · {t('viz.perUnit')}</p>
          <FormulaInput sel={sel} labelOf={(tag) => labelOf(tag, t)} formulas={formulas} setFormulas={setFormulas} />
        </Card>

        <div className="flex min-w-0 flex-col gap-3">
          {/* window bar — filters in one row above the charts */}
          <div className="flex flex-wrap items-center gap-2">
            {fixed ? (
              <>
                <span className="inline-flex h-7 items-center gap-1.5 rounded border border-line bg-white px-2 text-[12px]">
                  <Icon name="clock" size={12} /> {t('viz.custom')}: <span className="font-mono">{fmtRange(fromP, toP, i18n.language)}</span>
                </span>
                <button type="button" className="btn btn-sm" onClick={() => patch({ from: null, to: null })}>
                  {t('viz.backToLive')}
                </button>
              </>
            ) : (
              <>
                <Segmented
                  value={w}
                  onChange={(v) => patch({ w: v })}
                  label={t('viz.window')}
                  options={(Object.keys(WINDOWS) as WindowKey[]).map((k) => ({ value: k, label: k }))}
                />
                <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-68">
                  <span className="livedot" data-ws={live.ws === 'open' ? 'open' : 'reconnecting'} aria-hidden /> {t('viz.live')} · <span className="font-mono">{fmtRange(data.from, data.to, i18n.language)}</span>
                </span>
              </>
            )}
            <span className="flex-1" />
            <Segmented
              value={bars ? 'bars' : 'lines'}
              onChange={(v) => setBars(v === 'bars')}
              label={t('viz.display')}
              options={[
                { value: 'lines', label: t('viz.lines') },
                { value: 'bars', label: t('viz.bars') },
              ]}
            />
            <span className="hidden text-[11px] text-ink-46 md:inline">{t('viz.zoomHint')}</span>
            <AddToDashboard sel={sel} unitFor={unitFor} hasFormula={fRows.length > 0} orgId={orgId} canWrite={canWrite}
              onDone={(title) => setDashMsg(title)} />
            <button type="button" className="btn btn-sm btn-ghost" onClick={exportCsv} disabled={!data.hasData && !fAnyData}>
              <Icon name="download" size={12} /> {t('viz.exportCsv')}
            </button>
          </div>

          {dashMsg && (
            <Notice tone="ok" action={<Link to="/dashboards" className="btn btn-sm btn-ghost">{t('viz.openDash')}</Link>}>
              {dashMsg}
            </Notice>
          )}
          {data.truncated && <Notice tone="warn">{t('viz.truncated')}</Notice>}
          {badCount > 0 && <Notice>{t('viz.badHidden', { count: badCount })}</Notice>}
          {fDropped > 0 && <Notice tone="neutral">{t('viz.formulaDropped', { count: fDropped })}</Notice>}

          {sel.length === 0 && fRows.length === 0 ? (
            <Card><EmptyState title={t('trends.none')} icon="trends" /></Card>
          ) : [...groups.entries()].map(([unit, list]) => {
            const lim = list.length === 1 ? (limits.get(list[0].tag) ?? []).map((l) => ({ ...l, v: displayNumber(list[0].tag, l.v) })) : [];
            return (
              <Card
                key={unit || '—'}
                title={`${list.map((s) => labelOf(s.tag, t)).join(' · ')}${unit ? ` (${unit})` : ''}`}
                pad={false}
              >
                <div className="p-2">
                  <TimeChart
                    series={list.map((s) => ({
                      key: s.tag, label: labelOf(s.tag, t), color: colorOf(s.tag),
                      unit, decimals: decimalsOf(s.tag), pts: scalePts(s.tag, s.pts),
                    }))}
                    limits={lim}
                    unit={unit}
                    xRange={[data.from, data.to]}
                    height={groups.size > 1 ? 220 : 340}
                    syncKey="trends"
                    onZoom={onZoom}
                    loading={data.isLoading}
                    error={data.isError}
                    onRetry={data.refetch}
                    bars={bars}
                  />
                </div>
              </Card>
            );
          })}

          {fRows.length > 0 && (
            <Card
              title={t('viz.formulaTitle')}
              actions={<span className="rounded-full border border-dashed border-line px-1.5 text-[10px] font-semibold text-ink-46">{t('viz.formulaCalc')}</span>}
              pad={false}
            >
              <div className="p-2">
                <TimeChart
                  series={fRows.map((f, i) => ({
                    key: `f${i}`, label: f.src, color: fColorOf(i),
                    decimals: 3, pts: f.pts,
                  }))}
                  xRange={[data.from, data.to]}
                  height={200}
                  syncKey="trends"
                  onZoom={onZoom}
                  loading={data.isLoading}
                  error={data.isError}
                  onRetry={data.refetch}
                  bars={bars}
                />
              </div>
            </Card>
          )}

          {sel.length > 0 && !data.isLoading && (
            <Card title={t('viz.series')} pad={false}>
              <StatsTable
                series={data.series}
                fRows={fRows}
                colorOf={colorOf}
                fColorOf={fColorOf}
                unitFor={unitFor}
                sel={sel}
                setPal={setPal}
                onRemoveF={(i) => setFormulas(formulas.filter((_, j) => j !== i))}
              />
            </Card>
          )}
        </div>
      </div>
      )}
    </>
  );
}

/** Formula composer — letters map to the selected signals in order; the
 *  expression is validated on the client before it lands in the URL. */
function FormulaInput({ sel, labelOf, formulas, setFormulas }: {
  sel: string[]; labelOf: (tag: string) => string;
  formulas: string[]; setFormulas: (list: string[]) => void;
}) {
  const { t } = useTranslation();
  const [src, setSrc] = useState('');
  const parsed = parseFormula(src || ' ');
  const err = src.trim() && !parsed.ok ? parsed.err : null;
  const missingVar = parsed.ok ? parsed.vars.find((i) => i >= sel.length) : undefined;

  const add = () => {
    if (!parsed.ok || missingVar !== undefined || !src.trim()) return;
    setFormulas([...formulas, src.trim().toLowerCase()]);
    setSrc('');
  };

  return (
    <div className="border-t border-line p-2">
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 pb-1.5 text-[10px] text-ink-46">
        {sel.map((tag, i) => (
          <span key={tag} title={tag}>
            <span className="font-mono font-bold text-ink-68">{letter(i)}</span> = {labelOf(tag)}
          </span>
        ))}
        {sel.length === 0 && <span>{t('trends.none')}</span>}
      </div>
      <div className="flex gap-1.5">
        <input
          className="input h-7 min-w-0 flex-1 font-mono text-[12px]"
          value={src}
          placeholder={t('viz.formulaPh')}
          aria-label={t('viz.addFormula')}
          aria-invalid={!!err}
          onChange={(e) => setSrc(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
        />
        <button type="button" className="btn btn-sm" onClick={add}
          disabled={!src.trim() || !parsed.ok || missingVar !== undefined}>
          {t('viz.addFormula')}
        </button>
      </div>
      {(err || missingVar !== undefined) && (
        <p className="pt-1 text-[11px] text-[var(--color-danger)]" role="alert">
          {missingVar !== undefined
            ? t('viz.formulaNoVar', { letter: letter(missingVar), count: sel.length })
            : t(`viz.formulaErr${err![0].toUpperCase()}${err!.slice(1)}`)}
        </p>
      )}
      {formulas.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 pt-2">
          {formulas.map((f, i) => (
            <li key={`${f}-${i}`} className="inline-flex items-center gap-1 rounded border border-line bg-subtle px-1.5 py-0.5 font-mono text-[11px]">
              {f}
              <button type="button" className="grid h-4 w-4 place-items-center rounded text-ink-46 hover:text-ink focus-visible:outline-2 focus-visible:outline-blue"
                aria-label={t('viz.removeFormula', { src: f })}
                onClick={() => setFormulas(formulas.filter((_, j) => j !== i))}>
                <Icon name="x" size={10} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="pt-1 text-[10px] text-ink-46">{t('viz.formulaHint')} · {t('viz.formulaCalc')}</p>
    </div>
  );
}

function AddToDashboard({ sel, unitFor, hasFormula, orgId, canWrite, onDone }: {
  sel: string[]; unitFor: (tag: string) => string; hasFormula: boolean;
  orgId: string | null; canWrite: boolean; onDone: (title: string) => void;
}) {
  const { t } = useTranslation();
  const { boards } = useDashboardTargets(orgId);
  const [busy, setBusy] = useState(false);
  if (sel.length === 0) return null;
  return (
    <Dropdown
      label={<><Icon name="overview" size={12} /> {t('viz.addToDash')}</>}
      title={t('viz.addToDashTitle')}
      triggerClass="btn btn-sm btn-ghost"
    >
      {(close) => (
        <div className="p-2">
          <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-46">{t('nav.dashboards')}</p>
          <ul className="max-h-56 overflow-y-auto">
            {boards.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  disabled={busy}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-subtle focus-visible:outline-2 focus-visible:outline-blue disabled:opacity-50"
                  onClick={async () => {
                    setBusy(true);
                    const title = sel.map((tag) => SIGNALS[tag] ? t(SIGNALS[tag].labelKey) : shortName(tag)).join(' · ');
                    const unit = new Set(sel.map(unitFor)).size === 1 ? unitFor(sel[0]) : '';
                    const r = await addTrendWidget(d, { title, tags: sel, unit }, { orgId, canWrite });
                    setBusy(false);
                    if (r.ok) { onDone(t('viz.addedToDash', { name: r.title })); close(); }
                    else onDone(t('viz.addToDashFailed'));
                  }}
                >
                  <Icon name="overview" size={12} className="text-ink-46" />
                  <span className="min-w-0 flex-1 truncate">{d.title}</span>
                </button>
              </li>
            ))}
          </ul>
          {hasFormula && <p className="border-t border-line px-1 pt-1.5 text-[11px] text-ink-46">{t('viz.dashNote')}</p>}
        </div>
      )}
    </Dropdown>
  );
}

/** Per-series colour picker — swatches restricted to the validated ISA-101
 *  palette order (no red/orange/amber/green, which mean abnormal/running).
 *  Fixed-position popover: the stats table lives in an overflow-x scroll
 *  container, so an absolutely-positioned dropdown would be clipped. */
function ColorPick({ value, onPick, label }: { value: string; onPick: (c: string) => void; label: string }) {
  const { t } = useTranslation();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const root = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pos) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setPos(null); } };
    const onDown = (e: PointerEvent) => {
      const n = e.target as Node;
      if (!root.current?.contains(n) && !panel.current?.contains(n)) setPos(null);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [pos]);

  return (
    <span ref={root} className="inline-flex">
      <button
        type="button"
        title={label}
        aria-label={label}
        aria-expanded={pos != null}
        className="grid h-6 w-6 place-items-center rounded hover:bg-subtle focus-visible:outline-2 focus-visible:outline-blue"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setPos(pos ? null : { x: Math.min(r.left, window.innerWidth - 180), y: r.bottom + 4 });
        }}
      >
        <span className="h-[10px] w-[10px] rounded-full border border-black/10" style={{ background: value }} />
      </button>
      {pos && createPortal(
        <div
          ref={panel}
          role="listbox"
          aria-label={t('viz.palette')}
          className="fixed z-50 flex gap-1.5 rounded-dd border border-line bg-white p-2 shadow-flyout"
          style={{ left: pos.x, top: pos.y }}
        >
          {SERIES_PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              role="option"
              aria-selected={c === value}
              title={c}
              aria-label={c}
              className={`h-6 w-6 rounded-full border-2 ${c === value ? 'border-ink' : 'border-transparent'}`}
              style={{ background: c }}
              onClick={() => { onPick(c); setPos(null); }}
            />
          ))}
        </div>,
        document.body,
      )}
    </span>
  );
}

function StatsTable({ series, fRows, colorOf, fColorOf, unitFor, sel, setPal, onRemoveF }: {
  series: TagSeries[];
  fRows: FormulaRow[];
  colorOf: (tag: string) => string;
  fColorOf: (i: number) => string;
  unitFor: (tag: string) => string;
  sel: string[];
  setPal: (fn: (p: Record<string, string>) => Record<string, string>) => void;
  onRemoveF: (i: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  useStore(() => live.version);
  const f = (tag: string, v: number | null) => fmtNum(scaleV(tag, v), decimalsOf(tag), i18n.language);
  const ff = (v: number | null) => fmtNum(v, 3, i18n.language);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line text-left">
            {[t('viz.series'), t('viz.avg'), t('viz.min'), t('viz.max'), t('viz.sum'), t('viz.last'), t('viz.unit'), t('viz.quality')].map((h, i) => (
              <th key={h} scope="col" className={`h-7 px-3 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-68 ${i > 0 && i < 6 ? 'text-right' : ''}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {series.map((s) => {
            const tv = live.latest.get(s.tag);
            const stale = !tv || now - Date.parse(tv.ts) > STALE_MS;
            return (
              <tr key={s.tag} className="h-9 border-b border-line last:border-0">
                <td className="px-3">
                  <span className="flex items-center gap-2">
                    <ColorPick
                      value={colorOf(s.tag)}
                      label={t('viz.paletteFor', { name: labelOf(s.tag, t) })}
                      onPick={(c) => setPal((p) => ({ ...p, [s.tag]: c }))}
                    />
                    <span className="font-mono text-[10px] font-bold text-ink-46">{letter(sel.indexOf(s.tag))}</span>
                    <span className="truncate">{labelOf(s.tag, t)}</span>
                  </span>
                </td>
                <td className="px-3 text-right font-mono">{f(s.tag, s.stats.avg)}</td>
                <td className="px-3 text-right font-mono">{f(s.tag, s.stats.min)}</td>
                <td className="px-3 text-right font-mono">{f(s.tag, s.stats.max)}</td>
                <td className="px-3 text-right font-mono">{f(s.tag, s.stats.sum)}</td>
                <td className="px-3 text-right font-mono font-semibold">{f(s.tag, s.stats.last)}</td>
                <td className="px-3 text-ink-68">{unitFor(s.tag) || '—'}</td>
                <td className="px-3">{stale || (tv && tv.q !== 'good') ? <QualityMark q={tv?.q} stale={stale} /> : <span className="text-[12px] text-ink-46">{t('state.good')}</span>}</td>
              </tr>
            );
          })}
          {fRows.map((row, i) => (
            <tr key={`f${i}`} className="h-9 border-b border-line last:border-0 bg-subtle/50">
              <td className="px-3">
                <span className="flex items-center gap-2">
                  <ColorPick
                    value={fColorOf(i)}
                    label={t('viz.paletteFor', { name: row.src })}
                    onPick={(c) => setPal((p) => ({ ...p, [`f:${i}`]: c }))}
                  />
                  <span className="truncate font-mono text-[12px]" title={row.src}>{row.src}</span>
                  <span className="shrink-0 rounded-full border border-dashed border-line px-1.5 text-[10px] font-semibold text-ink-46" title={t('viz.formulaCalc')}>ƒ</span>
                  <button
                    type="button"
                    className="grid h-5 w-5 shrink-0 place-items-center rounded text-ink-46 hover:text-ink focus-visible:outline-2 focus-visible:outline-blue"
                    aria-label={t('viz.removeFormula', { src: row.src })}
                    onClick={() => onRemoveF(i)}
                  >
                    <Icon name="x" size={10} />
                  </button>
                </span>
              </td>
              {row.ok ? (
                <>
                  <td className="px-3 text-right font-mono">{ff(row.stats.avg)}</td>
                  <td className="px-3 text-right font-mono">{ff(row.stats.min)}</td>
                  <td className="px-3 text-right font-mono">{ff(row.stats.max)}</td>
                  <td className="px-3 text-right font-mono">{ff(row.stats.sum)}</td>
                  <td className="px-3 text-right font-mono font-semibold">{ff(row.stats.last)}</td>
                  <td className="px-3 text-ink-68">—</td>
                  <td className="px-3"><span className="text-[11px] text-ink-46">{t('viz.formulaResampled', { step: `${Math.round(row.step / 100) / 10}s` })}</span></td>
                </>
              ) : (
                <td colSpan={7} className="px-3 text-[12px] text-[var(--color-danger)]">
                  {t(`viz.formulaErr${row.err![0].toUpperCase()}${row.err!.slice(1)}`)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GridCard({ tag }: { tag: string }) {
  const { t } = useTranslation();
  const limits = useLimits();
  const data = useSeries([tag], { fromMs: 0, toMs: null, spanMs: WINDOWS['15m'] });
  const unit = unitOf(tag) ?? '';
  return (
    <Card pad={false}>
      <div className="border-b border-line px-3 py-1.5">
        <p className="text-[13px] font-medium">{labelOf(tag, t)}</p>
        <p className="font-mono text-[10px] text-ink-46">{tag}{unit ? ` · ${unit}` : ''}</p>
      </div>
      <div className="p-1">
        <TimeChart
          series={[{ key: tag, label: labelOf(tag, t), color: SERIES_PALETTE[0], unit, decimals: decimalsOf(tag), pts: scalePts(tag, data.series[0]?.pts ?? []) }]}
          limits={(limits.get(tag) ?? []).map((l) => ({ ...l, v: displayNumber(tag, l.v) }))}
          unit={unit}
          xRange={[data.from, data.to]}
          height={160}
          loading={data.isLoading}
          error={data.isError}
          onRetry={data.refetch}
          compact
        />
      </div>
    </Card>
  );
}
