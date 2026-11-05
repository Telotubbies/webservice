// Home — the plant summary: sections of customizable panels over live data,
// one time window and one filter row for the whole page (Datadog layout,
// Grafana-style panel options). Layout and theme are remembered per org.

import { lazy, Suspense, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { live } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { getScope } from '../../lib/scope';
import { EQUIPMENT } from '../../lib/plant';
import { useLimits } from '../trends/viz';
import { useAdminOrg } from '../admin/admin';
import {
  addPanel, defaultPanel, duplicatePanel, findPanel, legendClick, loadHome, movePanel, P, removePanel, resizePanel,
  saveHome, shiftPanel, updatePanel, defaultHome, type HomeState, type Panel,
} from './model';
import { useHomeData, type Filters, type Win } from './data';
import { PanelView, type PanelCtx } from './Panel';
import { fmtTime } from './chart';
import { Ico } from './icons';
import { useThemeName } from '../../theme/useTheme';
import { applyTheme, writeThemePref } from '../../theme/theme';
import './home.css';
import './i18n';

const Editor = lazy(() => import('./Editor'));

const RANGES = { '15m': 15 * 60e3, '1h': 3600e3, '4h': 4 * 3600e3, '24h': 24 * 3600e3 } as const;
type RangeKey = keyof typeof RANGES;
const RANGE_KEYS = Object.keys(RANGES) as RangeKey[];

const store = () => {
  try { return window.localStorage; } catch { return { getItem: () => null, setItem: () => {} }; }
};

function tzLabel() {
  const off = -new Date().getTimezoneOffset();
  const a = Math.abs(off);
  return `UTC${off >= 0 ? '+' : '-'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

export function HomePage({ footer }: { footer?: ReactNode }) {
  const { t, i18n } = useTranslation();
  const { orgName } = useAdminOrg();
  useStore(() => live.authRev);
  const org = getScope()?.orgId ?? 'default';
  const [home, setHome] = useState<HomeState>(() => loadHome(store(), org));
  const [homeOrg, setHomeOrg] = useState(org);
  if (homeOrg !== org) {            // switched org: load its own Home (derived state, no effect)
    setHomeOrg(org);
    setHome(loadHome(store(), org));
  }
  useEffect(() => { saveHome(store(), homeOrg, home); }, [homeOrg, home]);
  const { layout } = home;
  const theme = useThemeName();
  const flipTheme = () => { const next = theme === 'dark' ? 'light' : 'dark'; writeThemePref(next); applyTheme(next); };
  const setLayout = (fn: (l: typeof layout) => typeof layout) => setHome((h) => ({ ...h, layout: fn(h.layout) }));

  // time window: live, paused, or stepped back whole windows
  const [range, setRange] = useState<RangeKey>('1h');
  const [offset, setOffset] = useState(0);
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const now = useNow(5_000);
  const span = RANGES[range];
  const quantum = span / 120;
  const liveEnd = Math.ceil(now / quantum) * quantum;
  const end = pausedAt ?? liveEnd - offset * span;
  const win: Win = { from: end - span, to: end, span, live: pausedAt == null && offset === 0 };

  const [f, setF] = useState<Filters>({ equip: 'all', sev: 'all' });
  const [customize, setCustomize] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [fullId, setFullId] = useState<string | null>(null);
  const [tables, setTables] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<{ id: string; over: string | null } | null>(null);
  const dragId = useRef<string | null>(null);

  const data = useHomeData(layout, win, f);
  const limits = useLimits();
  useStore(() => live.version);

  const ctx: PanelCtx = { win, theme, f, customize, rangeShort: range, data, limits };
  const titleOf = (p: Panel) => p.title || (p.titleKey ? t(p.titleKey) : t('home.untitled'));
  const patch = (id: string, x: Partial<Panel> | ((p: Panel) => Partial<Panel>)) => setLayout((l) => updatePanel(l, id, x));
  const newId = () => `p${crypto.randomUUID().slice(0, 8)}`;
  const editing = editId ? findPanel(layout, editId) : null;

  const areas = useMemo(() => {
    const m = new Map<string, typeof EQUIPMENT>();
    for (const e of EQUIPMENT) {
      const a = e.id.split('.')[0];
      m.set(a, [...(m.get(a) ?? []), e]);
    }
    return [...m];
  }, []);

  const stepWindow = (dir: -1 | 1) => { setPausedAt(null); setOffset((o) => Math.max(0, o - dir)); };
  const togglePause = () => {
    if (offset > 0) { setOffset(0); setPausedAt(null); return; }
    setPausedAt((p) => (p == null ? liveEnd : null));
  };
  const filtered = f.equip !== 'all' || f.sev !== 'all';
  const updated = new Date(Math.min(end, now)).toLocaleTimeString(i18n.language.startsWith('th') ? 'th-TH' : 'en-GB');

  return (
    <div className={`hm ${theme === 'dark' ? 'hm-dark' : ''}`}>
      <header className="hm-top">
        <div className="hm-title">
          <h1>{t('home.title')}</h1>
          {orgName && <span className="hm-site">{orgName}</span>}
        </div>
        <div className="hm-tools">
          <div className="hm-time">
            <span className="hm-tz">{tzLabel()}</span>
            <div className="hm-tbox">
              <span className="hm-pill">{range}</span>
              <select className="hm-tsel" value={range} aria-label={t('home.timeRange')}
                onChange={(e) => { setRange(e.target.value as RangeKey); setOffset(0); setPausedAt(null); }}>
                {RANGE_KEYS.map((k) => <option key={k} value={k}>{t(`home.range_${k}`)}</option>)}
              </select>
            </div>
          </div>
          {!win.live && (
            <span className="hm-shifted">{t('home.shifted', { from: fmtTime(win.from, span, true, i18n.language), to: fmtTime(win.to, span, true, i18n.language) })}</span>
          )}
          <div className="hm-seg3">
            <button type="button" className="hm-ib" aria-label={t('home.prevWindow')} title={t('home.prevWindow')} onClick={() => stepWindow(-1)}><Ico name="back" /></button>
            <button type="button" className={`hm-ib ${win.live ? 'live' : ''}`} onClick={togglePause}
              aria-label={win.live ? t('home.pause') : offset ? t('home.backToLive') : t('home.resume')}
              title={win.live ? t('home.pause') : offset ? t('home.backToLive') : t('home.resume')}>
              <Ico name={win.live ? 'pause' : 'play'} size={14} />
            </button>
            <button type="button" className="hm-ib" disabled={offset === 0} aria-label={t('home.nextWindow')} title={t('home.nextWindow')} onClick={() => stepWindow(1)}><Ico name="fwd" /></button>
          </div>
          <button type="button" className="hm-ib" disabled={range === '24h'} aria-label={t('home.zoomOut')} title={t('home.zoomOut')}
            onClick={() => { const i = RANGE_KEYS.indexOf(range); setRange(RANGE_KEYS[Math.min(RANGE_KEYS.length - 1, i + 1)]); setOffset(0); }}>
            <Ico name="zoomOut" />
          </button>
          <span className="hm-vsep" aria-hidden />
          <button type="button" className={`hm-btn ${customize ? 'on' : ''}`} aria-pressed={customize} onClick={() => setCustomize((c) => !c)}>
            <Ico name="sliders" size={15} />{customize ? t('home.doneCustomize') : t('home.customize')}
          </button>
          <button type="button" className="hm-ib" aria-label={theme === 'dark' ? t('home.themeLight') : t('home.themeDark')}
            title={theme === 'dark' ? t('home.themeLight') : t('home.themeDark')}
            onClick={flipTheme}>
            <Ico name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
        </div>
      </header>

      <div className="hm-filters" role="search" aria-label={t('home.filters')}>
        <div className="hm-fg">
          <label className="hm-fl" htmlFor="hm-eq">{t('home.fEquipment')}</label>
          <select id="hm-eq" className="hm-sel" value={f.equip} onChange={(e) => setF((x) => ({ ...x, equip: e.target.value }))}>
            <option value="all">{t('home.fAllEquipment')}</option>
            {areas.map(([a, list]) => (
              <optgroup key={a} label={t(`home.area_${a}`)}>
                {list.map((e) => <option key={e.id} value={e.id}>{t(e.labelKey)}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="hm-fg">
          <label className="hm-fl" htmlFor="hm-sev">{t('home.fSeverity')}</label>
          <select id="hm-sev" className="hm-sel" value={f.sev} onChange={(e) => setF((x) => ({ ...x, sev: e.target.value }))}>
            <option value="all">{t('home.fAllSeverity')}</option>
            <option value="critical">{t('home.sevCritical')}</option>
            <option value="warning">{t('home.sevWarning')}</option>
            <option value="info">{t('home.sevInfo')}</option>
          </select>
        </div>
        {filtered && <button type="button" className="hm-btn ghost sm" onClick={() => setF({ equip: 'all', sev: 'all' })}>{t('home.clearFilters')}</button>}
        <span className="grow" />
        <span className="hm-updated" aria-live="polite">
          <span className={`hm-dot ${win.live ? '' : 'off'}`} aria-hidden />
          {win.live ? t('home.live', { time: updated }) : t('home.paused', { time: updated })}
        </span>
      </div>

      {customize && (
        <div className="hm-cust" role="status">
          <Ico name="grip" />
          <span>{t('home.custHint')}</span>
          <span className="grow" />
          <button type="button" className="hm-btn sm" onClick={() => { setHome((h) => ({ ...h, layout: defaultHome() })); setEditId(null); setFullId(null); }}>{t('home.resetHome')}</button>
          <button type="button" className="hm-btn sm primary" onClick={() => setCustomize(false)}>{t('home.doneCustomize')}</button>
        </div>
      )}

      <div className="hm-body">
        {layout.map((sec) => (
          <section key={sec.id} aria-labelledby={`hm-h-${sec.id}`}>
            <div className="hm-sec-head">
              <h2 id={`hm-h-${sec.id}`}>{t(sec.titleKey)}</h2>
              <Link to={sec.href} className="hm-link">{t(sec.linkKey)}<Ico name="arrow" size={14} /></Link>
            </div>
            <div className="hm-groups">
              {sec.groups.map((g) => (
                <div key={g.id} className={`hm-group ${g.joined ? 'joined' : ''}`} style={{ '--span': g.cols } as React.CSSProperties}>
                  {g.titleKey && (
                    <div className="hm-grp-head">
                      <h3>{t(g.titleKey)}</h3>
                      {g.href && g.linkKey && <Link to={g.href} className="hm-link">{t(g.linkKey)}</Link>}
                    </div>
                  )}
                  <div className="hm-cells">
                    {g.panels.map((p, i) => {
                      const title = titleOf(p);
                      const onDrop = (e: DragEvent) => { e.preventDefault(); const id = dragId.current; dragId.current = null; setDrag(null); if (id) setLayout((l) => movePanel(l, id, p.id, null)); };
                      return (
                        <PanelView
                          key={p.id} p={p} title={title} idx={i} count={g.panels.length} ctx={ctx}
                          st={{ editing: editId === p.id, full: fullId === p.id, table: tables.has(p.id), over: !!drag && drag.over === p.id && drag.id !== p.id, dragging: drag?.id === p.id }}
                          on={{
                            edit: () => { setEditId(p.id); setFullId(null); },
                            full: () => setFullId((x) => (x === p.id ? null : p.id)),
                            table: () => setTables((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; }),
                            legend: (src, toggle) => patch(p.id, (q) => legendClick(q, src, toggle)),
                            move: (dir) => setLayout((l) => shiftPanel(l, p.id, dir)),
                            resize: (dir) => setLayout((l) => resizePanel(l, p.id, dir)),
                            duplicate: () => setLayout((l) => { const id = newId(); return updatePanel(duplicatePanel(l, p.id, id), id, { title: t('home.copyOf', { title }) }); }),
                            remove: () => { setLayout((l) => removePanel(l, p.id)); if (editId === p.id) setEditId(null); },
                            clearFilters: () => setF({ equip: 'all', sev: 'all' }),
                            dragStart: (e) => { if (!customize) { e.preventDefault(); return; } dragId.current = p.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', p.id); setDrag({ id: p.id, over: null }); },
                            dragOver: (e) => { if (!dragId.current) return; e.preventDefault(); if (drag?.over !== p.id) setDrag((d) => (d ? { ...d, over: p.id } : d)); },
                            drop: onDrop,
                            dragEnd: () => { dragId.current = null; setDrag(null); },
                          }}
                        />
                      );
                    })}
                    {customize && (
                      <button
                        type="button" className="hm-add"
                        onClick={() => { const id = newId(); setLayout((l) => addPanel(l, g.id, P({ id, titleKey: 'home.pNew', series: [{ src: 'tag:plant1.batch.mix.mixer1.current_a', color: 's0' }], header: 'single' }))); setEditId(id); }}
                        onDragOver={(e) => { if (dragId.current) e.preventDefault(); }}
                        onDrop={(e) => { e.preventDefault(); const id = dragId.current; dragId.current = null; setDrag(null); if (id) setLayout((l) => movePanel(l, id, null, g.id)); }}
                      >
                        <Ico name="plus" size={20} />{t('home.addPanel')}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
        {footer}
      </div>

      {fullId && <button type="button" className="hm-scrim" aria-label={t('home.closeFull')} onClick={() => setFullId(null)} />}
      {editing && (
        <Suspense fallback={null}>
          <Editor
            p={editing} title={titleOf(editing)} theme={theme} limits={limits} canReset={!!defaultPanel(editing.id)}
            onPatch={(x) => patch(editing.id, x)} onClose={() => setEditId(null)}
            onRemove={() => { setLayout((l) => removePanel(l, editing.id)); setEditId(null); }}
            onReset={() => { const d = defaultPanel(editing.id); if (d) patch(editing.id, d); }}
          />
        </Suspense>
      )}
    </div>
  );
}
