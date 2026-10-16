// Dashboards — list (preset lists, search, star, new) and a canvas with an
// edit mode: drag by the widget header, resize from the corner, add / edit /
// duplicate / delete widgets through the widget editor.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import ReactGridLayout, { useContainerWidth, verticalCompactor, type Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import { Check, Copy, FastForward, FileText, GripVertical, Layers, LayoutDashboard, Maximize2, Pencil, Pause, Play, Plus, Rewind, RotateCcw, Search, Share2, Star, Trash2, X } from 'lucide-react';
import { EmptyState, Notice } from '../../shared/ui/Feedback';
import { Segmented } from '../../shared/ui/Segmented';
import { Confirm } from '../../shared/ui/Confirm';
import { ProductHeader } from '../../shared/ui/Product';
import { SavedViews } from '../../shared/ui/SavedViews';
import { dashboardApi } from '../../lib/api';
import { useAdminOrg } from '../admin/admin';
import { useNow } from '../../lib/hooks';
import { fmtClock } from '../../lib/format';
import { BoardCtx, WidgetBody } from './widgets';
import { DASH_TEMPLATES } from './templates';
import { WidgetEditor, autoTitle } from './WidgetEditor';
import {
  GROUP_TONE_STYLE, RANGE_MIN, loadDashboards, makeWidget, newId, resetDashboard, saveDashboards, varValues,
  type Dashboard, type RangeKey, type Widget,
} from './model';

const STAR_KEY = 'wds.dashStars'; // UI pref only
function readStars(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(STAR_KEY) ?? '[]')); } catch { return new Set(); }
}

const toRow = (d: Dashboard) => ({
  id: d.id, title: d.title, description: d.description, shared: d.shared ?? true,
  body: { range: d.range, widgets: d.widgets },
});

/** One store for both pages: local cache + sync of custom boards to the org.
 *  Server boards replace local custom ones on load; local-only ones are pushed. */
function useDashboards() {
  const { orgId, orgRole } = useAdminOrg();
  const canWrite = orgRole !== null && orgRole !== 'viewer';
  const [list, setList] = useState<Dashboard[]>(loadDashboards);
  const [saveFailed, setSaveFailed] = useState(false);
  const known = useRef(new Set<string>()); // ids that exist server-side
  const fail = () => setSaveFailed(true);

  useEffect(() => {
    if (!orgId) return;
    let live = true;
    dashboardApi.list(orgId).then(({ dashboards }) => {
      if (!live) return;
      dashboards.forEach((r) => known.current.add(r.id));
      setList((cur) => {
        const server = dashboards.map((r): Dashboard => ({
          id: r.id, title: r.title, description: r.description, preset: 'custom',
          author: r.mine ? 'you' : '', shared: r.shared, updatedAt: r.updated_at,
          range: (r.body.range as RangeKey) ?? '1h', widgets: (r.body.widgets as Widget[]) ?? [],
        }));
        const ids = new Set(server.map((d) => d.id));
        const localOnly = cur.filter((d) => d.preset === 'custom' && !ids.has(d.id));
        if (canWrite) localOnly.forEach((d) => dashboardApi.create(orgId, toRow(d)).then(() => known.current.add(d.id)).catch(fail));
        return [...cur.filter((d) => d.preset === 'builtin'), ...server, ...localOnly];
      });
    }).catch(() => { /* offline or no access: keep the local cache */ });
    return () => { live = false; };
  }, [orgId, canWrite]);

  const commit = useCallback((next: Dashboard[]) => {
    const prev = new Map(list.map((d) => [d.id, d]));
    setList(next);
    setSaveFailed(!saveDashboards(next));
    if (!orgId || !canWrite) return;
    for (const d of next) {
      if (d.preset !== 'custom' || prev.get(d.id) === d) continue;
      (known.current.has(d.id) ? dashboardApi.update(orgId, d.id, toRow(d)) : dashboardApi.create(orgId, toRow(d)))
        .then(() => known.current.add(d.id)).catch(fail);
    }
    const kept = new Set(next.map((d) => d.id));
    for (const d of list) {
      if (d.preset === 'custom' && !kept.has(d.id) && known.current.delete(d.id)) dashboardApi.remove(orgId, d.id).catch(fail);
    }
  }, [list, orgId, canWrite]);
  return { list, commit, saveFailed, canWrite };
}

type Preset = 'all' | 'mine' | 'custom' | 'builtin' | 'starred' | 'shared' | 'templates';
type Sort = 'recent' | 'title' | 'widgets';
const PRESETS: Preset[] = ['all', 'mine', 'shared', 'starred', 'custom', 'builtin', 'templates'];
const SORTS: Sort[] = ['recent', 'title', 'widgets'];

export function DashboardsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { list, commit, canWrite } = useDashboards();
  // List state lives in the URL (dd: the query string IS the saved view) —
  // SavedViews saves/applies it wholesale.
  const [sp, setSp] = useSearchParams();
  const preset = (PRESETS.includes(sp.get('view') as Preset) ? sp.get('view') : 'all') as Preset;
  const q = sp.get('q') ?? '';
  const sort = (SORTS.includes(sp.get('sort') as Sort) ? sp.get('sort') : 'recent') as Sort;
  const setParam = (k: 'view' | 'q' | 'sort', v: string, def: string) =>
    setSp((p) => {
      const n = new URLSearchParams(p);
      if (v === def) n.delete(k); else n.set(k, v);
      return n;
    }, { replace: true });
  const [stars, setStars] = useState(readStars);
  const toggleStar = (id: string) => setStars((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    try { localStorage.setItem(STAR_KEY, JSON.stringify([...n])); } catch { /* prefs are best-effort */ }
    return n;
  });

  const create = () => {
    const d: Dashboard = {
      id: newId(), title: t('dash.untitled'), description: '', preset: 'custom', author: 'you',
      updatedAt: new Date().toISOString(), range: '1h', widgets: [],
    };
    commit([...list, d]);
    navigate(`/dashboards/${d.id}?edit=1`);
  };

  const applyTemplate = (tpl: (typeof DASH_TEMPLATES)[number]) => {
    const d: Dashboard = {
      id: newId(), title: t(`dash.tpl_${tpl.id}`), description: t(`dash.tpl_${tpl.id}_d`), preset: 'custom',
      author: 'you', updatedAt: new Date().toISOString(), range: tpl.range, widgets: tpl.build(),
    };
    commit([...list, d]);
    navigate(`/dashboards/${d.id}`);
  };

  // "+ New dashboard" in the nav flyout lands here with ?new=1
  const autoNew = useRef(false);
  useEffect(() => {
    if (sp.get('new') === '1' && !autoNew.current) { autoNew.current = true; create(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);

  const inScope = (d: Dashboard) =>
    preset === 'all' || preset === 'templates'
      || (preset === 'mine' ? d.preset === 'custom' && d.author === 'you'
        : preset === 'starred' ? stars.has(d.id)
        : preset === 'shared' ? d.preset === 'custom' && d.author !== 'you'
        : d.preset === preset);
  const shown = list
    .filter((d) => inScope(d))
    .filter((d) => `${d.title} ${d.description}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) =>
      sort === 'title' ? a.title.localeCompare(b.title)
      : sort === 'widgets' ? b.widgets.length - a.widgets.length
      : b.updatedAt.localeCompare(a.updatedAt));
  const presets = PRESETS.map((k) => [k, t(`dash.preset${k[0].toUpperCase()}${k.slice(1)}`)] as const);

  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader icon="dashboard" title={t('dash.title')} tabs={[{ to: '/dashboards', label: t('dash.tabList'), end: true }]}
        actions={
          <div className="flex items-center gap-2">
            <SavedViews page="dashboards" />
            <Link to="/reports" className="btn btn-sm btn-ghost"><FileText size={14} aria-hidden /> {t('ddb.reportsLink')}</Link>
            {canWrite && <button type="button" className="btn btn-sm" onClick={create}><Plus size={14} aria-hidden /> {t('dash.new')}</button>}
          </div>
        } />
      <div className="flex flex-1 flex-col gap-4 p-4 md:flex-row">
        <aside className="w-full shrink-0 md:w-[220px]">
          <div className="relative">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-35" aria-hidden />
            <input className="input w-full pl-7" value={q} onChange={(e) => setParam('q', e.target.value, '')} placeholder={t('dash.searchPh')} aria-label={t('dash.searchPh')} />
          </div>
          <h2 className="mt-4 mb-1 text-[12px] font-semibold text-ink">{t('dash.presets')}</h2>
          <ul>
            {presets.map(([k, label]) => (
              <li key={k}>
                <button type="button" onClick={() => setParam('view', k, 'all')} aria-current={preset === k}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] focus-visible:outline-2 focus-visible:outline-blue ${preset === k ? 'bg-info-soft font-semibold text-ink' : 'text-ink-68 hover:bg-subtle'}`}>
                  <Star size={13} aria-hidden />{label}
                  <span className="ml-auto font-mono text-[11px] text-ink-46">
                    {k === 'templates' ? DASH_TEMPLATES.length : list.filter((d) =>
                      k === 'all' || (k === 'mine' ? d.preset === 'custom' && d.author === 'you'
                        : k === 'starred' ? stars.has(d.id)
                        : k === 'shared' ? d.preset === 'custom' && d.author !== 'you'
                        : d.preset === k)).length}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-2">
            <h2 className="flex-1 text-[18px] font-semibold">{presets.find(([k]) => k === preset)?.[1]}</h2>
            {preset !== 'templates' && (
              <label className="flex items-center gap-1.5 text-[12px] text-ink-68">
                {t('dash.sort')}
                <select className="input h-7 w-auto text-[12px]" value={sort} onChange={(e) => setParam('sort', e.target.value, 'recent')} aria-label={t('dash.sort')}>
                  <option value="recent">{t('dash.sortRecent')}</option>
                  <option value="title">{t('dash.sortTitle')}</option>
                  <option value="widgets">{t('dash.sortWidgets')}</option>
                </select>
              </label>
            )}
          </div>
          {preset === 'templates' && (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {DASH_TEMPLATES.map((tpl) => (
                <li key={tpl.id} className="flex flex-col rounded-[5px] border border-line bg-white p-4 shadow-card">
                  <h3 className="flex items-center gap-2 text-[14px] font-semibold"><LayoutDashboard size={15} aria-hidden className="text-ink-46" />{t(`dash.tpl_${tpl.id}`)}</h3>
                  <p className="mt-1 flex-1 text-[12px] text-ink-68">{t(`dash.tpl_${tpl.id}_d`)}</p>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-[11px] text-ink-46">{t('dash.tplWidgets', { count: tpl.build().length })}</span>
                    <button type="button" className="btn btn-sm" onClick={() => applyTemplate(tpl)}>{t('dash.useTemplate')}</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {preset !== 'templates' && <div className="overflow-x-auto rounded-[5px] border border-line bg-white">
            <div className="border-b border-line px-3 py-2 text-[12px] text-ink-68">{t('dash.count', { count: shown.length })}</div>
            {shown.length === 0 ? <EmptyState title={t('dash.empty')} icon="search" /> : (
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left">
                    <th scope="col" className="h-8 w-12 px-3"><span className="sr-only">{t('dash.star')}</span></th>
                    {['colName', 'colPreset', 'colAuthor', 'colWidgets', 'colModified'].map((c) => (
                      <th key={c} scope="col" className="h-8 px-3 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-68">{t(`dash.${c}`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((d) => (
                    <tr key={d.id} className="h-14 border-b border-line last:border-0 hover:bg-info-soft">
                      <td className="px-3">
                        <button type="button" role="checkbox" aria-checked={stars.has(d.id)} aria-label={t('dash.starNamed', { name: d.title })} onClick={() => toggleStar(d.id)}
                          className={`grid h-8 w-8 place-items-center rounded focus-visible:outline-2 focus-visible:outline-blue ${stars.has(d.id) ? 'text-[var(--color-warn)]' : 'text-ink-35 hover:text-ink-68'}`}>
                          <Star size={16} fill={stars.has(d.id) ? 'currentColor' : 'none'} aria-hidden />
                        </button>
                      </td>
                      <td className="px-3"><Link to={`/dashboards/${d.id}`} className="flex items-center gap-2 font-medium text-ink hover:text-blue hover:underline"><LayoutDashboard size={15} aria-hidden className="text-ink-46" />{d.title}</Link></td>
                      <td className="px-3"><span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-68">{t(d.preset === 'builtin' ? 'dash.presetBuiltin' : 'dash.presetCustom')}</span></td>
                      <td className="px-3 text-ink-68">{d.author}</td>
                      <td className="px-3 font-mono text-[12px]">{d.widgets.length}</td>
                      <td className="px-3 text-[12px] text-ink-68">{new Date(d.updatedAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>}
        </section>
      </div>
    </div>
  );
}

const RANGES: RangeKey[] = ['15m', '1h', '4h', '24h'];
/** Layout runs on half rows (50px) so a header bar can be half a row tall; stored
 *  y/h stay in the original whole-row units (x2 going in, /2 coming out). */
const ROW_H = 50;
const UNIT = 2;

export function DashboardViewPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const { list, commit, saveFailed, canWrite } = useDashboards();
  const dash = list.find((d) => d.id === id);
  const [edit, setEdit] = useState(() => new URLSearchParams(location.search).get('edit') === '1');
  const [editing, setEditing] = useState<Widget | null>(null);
  const [full, setFull] = useState<Widget | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { width, containerRef, mounted } = useContainerWidth();
  // board state: paused window end (null = live tail), overlay strip toggle,
  // and template-variable selections ($line / $equipment …, '*' = All)
  const now = useNow();
  const [endMs, setEndMs] = useState<number | null>(null);
  const [overlays, setOverlays] = useState(false);
  const [vars, setVars] = useState<Record<string, string>>({});
  const [sharedNote, setSharedNote] = useState('');

  const update = useCallback((p: Partial<Dashboard>) => {
    commit(list.map((d) => (d.id === id ? { ...d, ...p, updatedAt: new Date().toISOString() } : d)));
  }, [commit, list, id]);

  const layout: Layout = useMemo(
    () => (dash?.widgets ?? []).map((w) => ({ i: w.id, x: w.x, y: Math.round(w.y * UNIT), w: w.w, h: Math.max(1, Math.round(w.h * UNIT)), minW: 2, minH: 1 })),
    [dash?.widgets],
  );

  if (!dash) {
    return <div className="p-4"><EmptyState title={t('dash.notFound')} action={<Link to="/dashboards" className="text-blue hover:underline">{t('dash.back')}</Link>} /></div>;
  }

  const bottom = Math.max(0, ...dash.widgets.map((w) => w.y + w.h));
  // viewers never get edit affordances — even with a forged ?edit=1 param
  const editable = edit && canWrite;
  const rangeMs = RANGE_MIN[dash.range] * 60e3;
  // rewind step = a quarter of the visible window, ≥ 1 min
  const stepMs = Math.max(60e3, rangeMs / 4);
  const share = () => {
    const url = `${location.origin}/dashboards/${dash.id}`;
    navigator.clipboard?.writeText(url)
      .then(() => setSharedNote(t('ddb.linkCopied')))
      .catch(() => setSharedNote(url));
  };
  const saveWidget = (w: Widget) => {
    const exists = dash.widgets.some((x) => x.id === w.id);
    update({ widgets: exists ? dash.widgets.map((x) => (x.id === w.id ? w : x)) : [...dash.widgets, { ...w, y: bottom }] });
    setEditing(null);
  };
  const onLayoutChange = (l: Layout) => {
    if (!editable) return;
    const pos = new Map(l.map((it) => [it.i, it]));
    const moved = dash.widgets.some((w) => { const p = pos.get(w.id); return p && (p.x !== w.x || p.y !== Math.round(w.y * UNIT) || p.w !== w.w || p.h !== Math.max(1, Math.round(w.h * UNIT))); });
    if (moved) update({ widgets: dash.widgets.map((w) => { const p = pos.get(w.id); return p ? { ...w, x: p.x, y: p.y / UNIT, w: p.w, h: p.h / UNIT } : w; }) });
  };

  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader icon="dashboard" title={dash.title}
        actions={
          <div className="flex items-center gap-2">
            {/* pause / rewind the whole board — every data widget reads the
                same fixed window through BoardCtx */}
            <div className="flex items-center gap-0.5" role="group" aria-label={t('ddb.timeControls')}>
              <IconBtn label={t('ddb.rewind')} onClick={() => setEndMs((e) => (e ?? now) - stepMs)}><Rewind size={14} /></IconBtn>
              <IconBtn label={endMs == null ? t('ddb.pause') : t('ddb.resume')}
                onClick={() => setEndMs((e) => (e == null ? now : null))}>
                {endMs == null ? <Pause size={14} /> : <Play size={14} />}
              </IconBtn>
              <IconBtn label={t('ddb.forward')}
                onClick={() => setEndMs((e) => {
                  if (e == null) return null;
                  const n = e + stepMs;
                  return n >= now - 2000 ? null : n;
                })}>
                <FastForward size={14} />
              </IconBtn>
            </div>
            <IconBtn label={t('ddb.overlays')} onClick={() => setOverlays((v) => !v)} pressed={overlays}><Layers size={14} /></IconBtn>
            <Segmented value={dash.range} onChange={(r) => update({ range: r })} label={t('dash.range')}
              options={RANGES.map((r) => ({ value: r, label: t('dash.past', { r }) }))} />
            {editable ? (
              <>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(makeWidget('timeseries'))}><Plus size={14} aria-hidden /> {t('dash.addWidget')}</button>
                {dash.preset === 'builtin' && (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => { const s = resetDashboard(dash.id); if (s) update({ widgets: s.widgets, range: s.range }); }}>
                    <RotateCcw size={14} aria-hidden /> {t('dash.reset')}
                  </button>
                )}
                {dash.preset === 'custom' && (
                  <label className="flex items-center gap-1.5 text-[12px] text-ink-68">
                    <input type="checkbox" checked={dash.shared ?? true} onChange={(e) => update({ shared: e.target.checked })} />
                    {t('dash.shareOrg')}
                  </label>
                )}
                {dash.preset === 'custom' && (
                  <button type="button" className="btn btn-sm btn-ghost text-[var(--color-danger)]" onClick={() => setConfirmDelete(true)}><Trash2 size={14} aria-hidden /> {t('dash.delete')}</button>
                )}
                <button type="button" className="btn btn-sm" onClick={() => setEdit(false)}><Check size={14} aria-hidden /> {t('dash.done')}</button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn-sm btn-ghost" onClick={share} title={t('ddb.shareTitle')}>
                  <Share2 size={14} aria-hidden /> {t('ddb.share')}
                </button>
                {canWrite && (
                  <>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => {
                      const c = { ...structuredClone(dash), id: newId(), title: t('dash.copyOf', { name: dash.title }), preset: 'custom' as const, author: 'you' };
                      commit([...list, c]); navigate(`/dashboards/${c.id}?edit=1`); setEdit(true);
                    }}><Copy size={14} aria-hidden /> {t('dash.clone')}</button>
                    <button type="button" className="btn btn-sm" onClick={() => setEdit(true)}><Pencil size={14} aria-hidden /> {t('dash.edit')}</button>
                  </>
                )}
              </>
            )}
          </div>
        } />

      <div className="flex flex-wrap items-center gap-3 px-4 pt-3 text-[12px]">
        <Link to="/dashboards" className="text-blue hover:underline">← {t('dash.back')}</Link>
        {/* template variables — pick-lists over real signal segments; widgets
            and alarm surfaces re-filter live */}
        {(dash.vars ?? []).map((v) => (
          <label key={v.name} className="flex items-center gap-1.5">
            <span className="font-mono text-ink-68">${v.name}</span>
            <select className="input h-7 w-auto text-[12px]" value={vars[v.name] ?? '*'}
              onChange={(e) => setVars((s) => ({ ...s, [v.name]: e.target.value }))}
              aria-label={`$${v.name}`}>
              <option value="*">{t('ddb.varAll')}</option>
              {varValues(v.kind).map((x) => <option key={x} value={x}>{v.kind === 'equipment' ? t(`line.${x}`) : x}</option>)}
            </select>
          </label>
        ))}
        {endMs != null && (
          <span className="flex items-center gap-1.5 rounded-full border border-[var(--color-caution)]/50 bg-[var(--color-caution-soft)] px-2 py-0.5 text-[11px] font-semibold text-[#8a5a00]">
            {t('ddb.pausedAt', { t: fmtClock(new Date(endMs).toISOString()) })}
            <button type="button" className="underline" onClick={() => setEndMs(null)}>{t('ddb.resume')}</button>
          </span>
        )}
        <span className="sr-only" aria-live="polite">{sharedNote}</span>
        {editable && (
          <label className="ml-auto flex items-center gap-2">
            <span className="text-ink-68">{t('dash.titleLabel')}</span>
            <input className="input w-72" value={dash.title} onChange={(e) => update({ title: e.target.value })} />
          </label>
        )}
      </div>
      {editable && <div className="px-4 pt-2"><Notice>{t('dash.editHint')}</Notice></div>}
      {saveFailed && <div className="px-4 pt-2"><Notice tone="warn">{t('dash.saveFailed')}</Notice></div>}

      <div ref={containerRef} className="px-2 pb-6">
        {dash.widgets.length === 0 && (
          <EmptyState title={t('dash.emptyBoard')} body={t('dash.emptyBoardBody')}
            action={canWrite ? <button type="button" className="btn btn-sm" onClick={() => { setEdit(true); setEditing(makeWidget('timeseries')); }}><Plus size={14} aria-hidden /> {t('dash.addWidget')}</button> : undefined} />
        )}
        {mounted && dash.widgets.length > 0 && (
          <BoardCtx.Provider value={{ endMs, overlays, vars, varDefs: dash.vars ?? [] }}>
          <ReactGridLayout
            width={width} layout={layout} compactor={verticalCompactor}
            gridConfig={{ cols: 12, rowHeight: ROW_H, margin: [12, 12] }}
            dragConfig={{ enabled: editable, handle: '.widget-drag' }}
            resizeConfig={{ enabled: editable, handles: ['se'] }}
            onLayoutChange={onLayoutChange}
          >
            {dash.widgets.map((w) => (
              <div key={w.id}>
                {w.kind === 'group' ? (
                  /* dd group header: pastel themed bar + one-line description; the tiles below it belong to it */
                  <section
                    className={`flex h-full flex-col justify-center gap-0 rounded-[3px] px-2 ${editable ? 'outline-dashed outline-1 outline-white/60' : ''}`}
                    style={{ background: GROUP_TONE_STYLE[w.tone ?? 'blue'].header, color: GROUP_TONE_STYLE[w.tone ?? 'blue'].ink }}
                    aria-label={w.title || autoTitle(w)}>
                    <div className="flex items-center gap-1">
                      {editable && <span className="widget-drag grid h-6 w-5 cursor-move place-items-center opacity-70" aria-hidden><GripVertical size={14} /></span>}
                      <h3 className="min-w-0 flex-1 truncate text-[14px] font-semibold">{w.title || autoTitle(w)}</h3>
                      {editable && (
                        <>
                          <IconBtn label={t('dash.editWidgetNamed', { name: w.title || autoTitle(w) })} onClick={() => setEditing(w)}><Pencil size={13} /></IconBtn>
                          <IconBtn label={t('dash.removeWidget')} onClick={() => update({ widgets: dash.widgets.filter((x) => x.id !== w.id) })}><Trash2 size={13} /></IconBtn>
                        </>
                      )}
                    </div>
                    {w.note && <p className="truncate px-5 pb-0.5 text-[11px] opacity-80">{w.note}</p>}
                  </section>
                ) : (
                <section className={`flex h-full flex-col rounded-[5px] border bg-white ${editable ? 'border-dashed border-blue' : 'border-line'}`} aria-label={w.title || autoTitle(w)}>
                  <header className="flex h-8 shrink-0 items-center gap-1 border-b border-line pl-2 pr-1">
                    {editable && <span className="widget-drag grid h-6 w-5 cursor-move place-items-center text-ink-46" aria-hidden><GripVertical size={14} /></span>}
                    <h3 className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink">{w.title || autoTitle(w)}</h3>
                    <IconBtn label={t('dash.fullscreen')} onClick={() => setFull(w)}><Maximize2 size={13} /></IconBtn>
                    {editable && (
                      <>
                        <IconBtn label={t('dash.editWidgetNamed', { name: w.title || autoTitle(w) })} onClick={() => setEditing(w)}><Pencil size={13} /></IconBtn>
                        <IconBtn label={t('dash.duplicate')} onClick={() => update({ widgets: [...dash.widgets, { ...structuredClone(w), id: newId(), y: bottom }] })}><Copy size={13} /></IconBtn>
                        <IconBtn label={t('dash.removeWidget')} onClick={() => update({ widgets: dash.widgets.filter((x) => x.id !== w.id) })}><Trash2 size={13} /></IconBtn>
                      </>
                    )}
                  </header>
                  <div className="min-h-0 flex-1 p-2"><WidgetBody w={w} range={dash.range} /></div>
                </section>
                )}
              </div>
            ))}
          </ReactGridLayout>
          </BoardCtx.Provider>
        )}
      </div>

      {full && <FullWidget w={full} range={dash.range} onClose={() => setFull(null)} />}
      {editing && <WidgetEditor initial={editing} range={dash.range} onSave={saveWidget} onClose={() => setEditing(null)} />}
      {confirmDelete && (
        <Confirm
          title={t('dash.deleteTitle', { name: dash.title })} body={t('dash.deleteBody')} confirm={t('dash.delete')} danger
          onNo={() => setConfirmDelete(false)}
          onYes={() => { commit(list.filter((d) => d.id !== dash.id)); navigate('/dashboards'); }}
        />
      )}
    </div>
  );
}

/** Datadog-style full-screen view of one widget; Esc / backdrop click closes. */
function FullWidget({ w, range, onClose }: { w: Widget; range: RangeKey; onClose: () => void }) {
  const { t } = useTranslation();
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  const title = w.title || autoTitle(w);
  return (
    <dialog ref={dlg} onClose={onClose} aria-label={title}
      onClick={(e) => { if (e.target === dlg.current) dlg.current?.close(); }}
      className="m-auto h-[88vh] w-[min(1400px,96vw)] max-w-none rounded-[6px] border border-line p-0 shadow-pop backdrop:bg-black/40">
      <div className="flex h-full flex-col">
        <header className="flex h-11 items-center border-b border-line px-4">
          <h2 className="flex-1 truncate text-[14px] font-semibold">{title}</h2>
          <button type="button" className="grid h-8 w-8 place-items-center rounded hover:bg-subtle" aria-label={t('common.close')} onClick={() => dlg.current?.close()}><X size={16} /></button>
        </header>
        <div className="min-h-0 flex-1 p-4"><WidgetBody w={w} range={range} /></div>
      </div>
    </dialog>
  );
}

function IconBtn({ label, onClick, pressed, children }: { label: string; onClick: () => void; pressed?: boolean; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}
      aria-pressed={pressed}
      // keep pointer events on the button from starting a grid drag
      onMouseDown={(e) => e.stopPropagation()}
      className={`grid h-7 w-7 place-items-center rounded focus-visible:outline-2 focus-visible:outline-blue ${pressed ? 'bg-info-soft text-blue' : 'text-ink-68 hover:bg-subtle hover:text-ink'}`}>
      {children}
    </button>
  );
}
