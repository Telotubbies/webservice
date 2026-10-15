// Dashboards — list (preset lists, search, star, new) and a canvas with an
// edit mode: drag by the widget header, resize from the corner, add / edit /
// duplicate / delete widgets through the widget editor.

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import ReactGridLayout, { useContainerWidth, verticalCompactor, type Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import { Check, Copy, GripVertical, LayoutDashboard, Pencil, Plus, RotateCcw, Search, Star, Trash2 } from 'lucide-react';
import { EmptyState, Notice } from '../../shared/ui/Feedback';
import { Segmented } from '../../shared/ui/Segmented';
import { Confirm } from '../../shared/ui/Confirm';
import { ProductHeader } from '../../shared/ui/Product';
import { WidgetBody } from './widgets';
import { WidgetEditor, autoTitle } from './WidgetEditor';
import {
  loadDashboards, makeWidget, newId, resetDashboard, saveDashboards,
  type Dashboard, type RangeKey, type Widget,
} from './model';

const STAR_KEY = 'wds.dashStars'; // UI pref only
function readStars(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(STAR_KEY) ?? '[]')); } catch { return new Set(); }
}

/** One store for both pages: state + persist-on-change. */
function useDashboards() {
  const [list, setList] = useState<Dashboard[]>(loadDashboards);
  const [saveFailed, setSaveFailed] = useState(false);
  const commit = useCallback((next: Dashboard[]) => {
    setList(next);
    setSaveFailed(!saveDashboards(next));
  }, []);
  return { list, commit, saveFailed };
}

export function DashboardsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { list, commit } = useDashboards();
  const [q, setQ] = useState('');
  const [preset, setPreset] = useState<'all' | 'custom' | 'builtin' | 'starred'>('all');
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

  const shown = list
    .filter((d) => preset === 'all' || (preset === 'starred' ? stars.has(d.id) : d.preset === preset))
    .filter((d) => d.title.toLowerCase().includes(q.toLowerCase()));
  const presets = [
    ['all', t('dash.presetAll')], ['custom', t('dash.presetCustom')],
    ['builtin', t('dash.presetBuiltin')], ['starred', t('dash.presetStarred')],
  ] as const;

  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader icon="dashboard" title={t('dash.title')} tabs={[{ to: '/dashboards', label: t('dash.tabList'), end: true }]}
        actions={<button type="button" className="btn btn-sm" onClick={create}><Plus size={14} aria-hidden /> {t('dash.new')}</button>} />
      <div className="flex flex-1 gap-4 p-4">
        <aside className="w-[220px] shrink-0">
          <div className="relative">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-35" aria-hidden />
            <input className="input w-full pl-7" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('dash.searchPh')} aria-label={t('dash.searchPh')} />
          </div>
          <h2 className="mt-4 mb-1 text-[12px] font-semibold text-ink">{t('dash.presets')}</h2>
          <ul>
            {presets.map(([k, label]) => (
              <li key={k}>
                <button type="button" onClick={() => setPreset(k)} aria-current={preset === k}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] focus-visible:outline-2 focus-visible:outline-blue ${preset === k ? 'bg-info-soft font-semibold text-ink' : 'text-ink-68 hover:bg-subtle'}`}>
                  <Star size={13} aria-hidden />{label}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="min-w-0 flex-1">
          <h2 className="mb-2 text-[18px] font-semibold">{presets.find(([k]) => k === preset)?.[1]}</h2>
          <div className="overflow-x-auto rounded-[5px] border border-line bg-white">
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
          </div>
        </section>
      </div>
    </div>
  );
}

const RANGES: RangeKey[] = ['15m', '1h', '4h', '24h'];
const ROW_H = 100;

export function DashboardViewPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const { list, commit, saveFailed } = useDashboards();
  const dash = list.find((d) => d.id === id);
  const [edit, setEdit] = useState(() => new URLSearchParams(location.search).get('edit') === '1');
  const [editing, setEditing] = useState<Widget | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { width, containerRef, mounted } = useContainerWidth();

  const update = useCallback((p: Partial<Dashboard>) => {
    commit(list.map((d) => (d.id === id ? { ...d, ...p, updatedAt: new Date().toISOString() } : d)));
  }, [commit, list, id]);

  const layout: Layout = useMemo(
    () => (dash?.widgets ?? []).map((w) => ({ i: w.id, x: w.x, y: w.y, w: w.w, h: w.h, minW: 2, minH: 1 })),
    [dash?.widgets],
  );

  if (!dash) {
    return <div className="p-4"><EmptyState title={t('dash.notFound')} action={<Link to="/dashboards" className="text-blue hover:underline">{t('dash.back')}</Link>} /></div>;
  }

  const bottom = Math.max(0, ...dash.widgets.map((w) => w.y + w.h));
  const saveWidget = (w: Widget) => {
    const exists = dash.widgets.some((x) => x.id === w.id);
    update({ widgets: exists ? dash.widgets.map((x) => (x.id === w.id ? w : x)) : [...dash.widgets, { ...w, y: bottom }] });
    setEditing(null);
  };
  const onLayoutChange = (l: Layout) => {
    if (!edit) return;
    const pos = new Map(l.map((it) => [it.i, it]));
    const moved = dash.widgets.some((w) => { const p = pos.get(w.id); return p && (p.x !== w.x || p.y !== w.y || p.w !== w.w || p.h !== w.h); });
    if (moved) update({ widgets: dash.widgets.map((w) => { const p = pos.get(w.id); return p ? { ...w, x: p.x, y: p.y, w: p.w, h: p.h } : w; }) });
  };

  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader icon="dashboard" title={dash.title}
        actions={
          <div className="flex items-center gap-2">
            <Segmented value={dash.range} onChange={(r) => update({ range: r })} label={t('dash.range')}
              options={RANGES.map((r) => ({ value: r, label: t('dash.past', { r }) }))} />
            {edit ? (
              <>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(makeWidget('timeseries'))}><Plus size={14} aria-hidden /> {t('dash.addWidget')}</button>
                {dash.preset === 'builtin' && (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => { const s = resetDashboard(dash.id); if (s) update({ widgets: s.widgets, range: s.range }); }}>
                    <RotateCcw size={14} aria-hidden /> {t('dash.reset')}
                  </button>
                )}
                {dash.preset === 'custom' && (
                  <button type="button" className="btn btn-sm btn-ghost text-[var(--color-danger)]" onClick={() => setConfirmDelete(true)}><Trash2 size={14} aria-hidden /> {t('dash.delete')}</button>
                )}
                <button type="button" className="btn btn-sm" onClick={() => setEdit(false)}><Check size={14} aria-hidden /> {t('dash.done')}</button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => {
                  const c = { ...structuredClone(dash), id: newId(), title: t('dash.copyOf', { name: dash.title }), preset: 'custom' as const, author: 'you' };
                  commit([...list, c]); navigate(`/dashboards/${c.id}?edit=1`); setEdit(true);
                }}><Copy size={14} aria-hidden /> {t('dash.clone')}</button>
                <button type="button" className="btn btn-sm" onClick={() => setEdit(true)}><Pencil size={14} aria-hidden /> {t('dash.edit')}</button>
              </>
            )}
          </div>
        } />

      <div className="flex items-center gap-3 px-4 pt-3 text-[12px]">
        <Link to="/dashboards" className="text-blue hover:underline">← {t('dash.back')}</Link>
        {edit && (
          <label className="ml-auto flex items-center gap-2">
            <span className="text-ink-68">{t('dash.titleLabel')}</span>
            <input className="input w-72" value={dash.title} onChange={(e) => update({ title: e.target.value })} />
          </label>
        )}
      </div>
      {edit && <div className="px-4 pt-2"><Notice>{t('dash.editHint')}</Notice></div>}
      {saveFailed && <div className="px-4 pt-2"><Notice tone="warn">{t('dash.saveFailed')}</Notice></div>}

      <div ref={containerRef} className="px-2 pb-6">
        {dash.widgets.length === 0 && (
          <EmptyState title={t('dash.emptyBoard')} body={t('dash.emptyBoardBody')}
            action={<button type="button" className="btn btn-sm" onClick={() => { setEdit(true); setEditing(makeWidget('timeseries')); }}><Plus size={14} aria-hidden /> {t('dash.addWidget')}</button>} />
        )}
        {mounted && dash.widgets.length > 0 && (
          <ReactGridLayout
            width={width} layout={layout} compactor={verticalCompactor}
            gridConfig={{ cols: 12, rowHeight: ROW_H, margin: [12, 12] }}
            dragConfig={{ enabled: edit, handle: '.widget-drag' }}
            resizeConfig={{ enabled: edit, handles: ['se'] }}
            onLayoutChange={onLayoutChange}
          >
            {dash.widgets.map((w) => (
              <div key={w.id}>
                <section className={`flex h-full flex-col rounded-[5px] border bg-white ${edit ? 'border-dashed border-blue' : 'border-line'}`} aria-label={w.title || autoTitle(w)}>
                  <header className="flex h-8 shrink-0 items-center gap-1 border-b border-line pl-2 pr-1">
                    {edit && <span className="widget-drag grid h-6 w-5 cursor-move place-items-center text-ink-46" aria-hidden><GripVertical size={14} /></span>}
                    <h3 className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink">{w.title || autoTitle(w)}</h3>
                    {edit && (
                      <>
                        <IconBtn label={t('dash.editWidgetNamed', { name: w.title || autoTitle(w) })} onClick={() => setEditing(w)}><Pencil size={13} /></IconBtn>
                        <IconBtn label={t('dash.duplicate')} onClick={() => update({ widgets: [...dash.widgets, { ...structuredClone(w), id: newId(), y: bottom }] })}><Copy size={13} /></IconBtn>
                        <IconBtn label={t('dash.removeWidget')} onClick={() => update({ widgets: dash.widgets.filter((x) => x.id !== w.id) })}><Trash2 size={13} /></IconBtn>
                      </>
                    )}
                  </header>
                  <div className="min-h-0 flex-1 p-2"><WidgetBody w={w} range={dash.range} /></div>
                </section>
              </div>
            ))}
          </ReactGridLayout>
        )}
      </div>

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

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}
      // keep pointer events on the button from starting a grid drag
      onMouseDown={(e) => e.stopPropagation()}
      className="grid h-7 w-7 place-items-center rounded text-ink-68 hover:bg-subtle hover:text-ink focus-visible:outline-2 focus-visible:outline-blue">
      {children}
    </button>
  );
}
