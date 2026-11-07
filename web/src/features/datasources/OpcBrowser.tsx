// OPC UA node tree: lazy one-level browse through the edge; tick variables and
// "Add selected" creates them as tags (bulk CSV).

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { Notice } from '../../shared/ui/Feedback';
import { dsApi, type BrowseItem, type NodeLive } from './api';
import { browseToDrafts, csvErrorsFromBody, suggestSignal, tagsToCsv } from './logic';
import './i18n';

interface Node extends BrowseItem { children?: Node[]; open?: boolean; loading?: boolean }

const isVar = (n: BrowseItem) => /variable/i.test(n.node_class);
/** Line/device inputs only need to contain something name-able. */
const normOk = (s: string) => /[a-z0-9]/i.test(s);

function LiveValue({ x }: { x?: NodeLive }) {
  const { t } = useTranslation();
  if (!x) return null;
  const ok = x.q === 'good' && x.v !== null;
  return <span className={`font-mono text-[11px] ${ok ? 'text-ink' : 'text-ink-46'}`} title={x.q}>{ok ? String(x.v) : t('ds.noValue')}</span>;
}

export function OpcBrowser({ orgId, edgeId, sourceId, onAdded, onClose }: {
  orgId: string; edgeId: string; sourceId: string; onAdded: () => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  const [roots, setRoots] = useState<Node[] | null>(null);
  const [picked, setPicked] = useState<Map<string, Node>>(new Map());
  const [line, setLine] = useState('');
  const [device, setDevice] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [live, setLive] = useState<Map<string, NodeLive>>(new Map());
  const [names, setNames] = useState<Map<string, string>>(new Map());

  const explain = (e: unknown) => e instanceof ApiError
    ? (e.status === 504 ? t('ds.errTimeout') : e.status === 502 ? t('ds.errEdge') : t('ds.errGeneric', { reason: e.message }))
    : t('dev.errNetwork');

  const load = async (nodeId: string | null): Promise<Node[]> => (await dsApi.browse(orgId, edgeId, sourceId, nodeId)).items;

  /** Live values are a nicety: a failed read leaves the tree usable. */
  const readLive = async (nodes: BrowseItem[]) => {
    const ids = nodes.filter(isVar).slice(0, 50).map((n) => n.node_id);
    if (!ids.length) return;
    try {
      const r = await dsApi.readNodes(orgId, edgeId, sourceId, ids);
      setLive((m) => { const c = new Map(m); r.items.forEach((x) => c.set(x.node_id, x)); return c; });
    } catch { /* values stay blank */ }
  };

  const start = async () => {
    setBusy(true); setErr('');
    try { const r = await load(null); setRoots(r); void readLive(r); } catch (e) { setErr(explain(e)); } finally { setBusy(false); }
  };

  const update = (list: Node[], id: string, fn: (n: Node) => Node): Node[] =>
    list.map((n) => n.node_id === id ? fn(n) : n.children ? { ...n, children: update(n.children, id, fn) } : n);

  const toggle = async (n: Node) => {
    if (n.open) { setRoots((r) => r && update(r, n.node_id, (x) => ({ ...x, open: false }))); return; }
    if (n.children) { setRoots((r) => r && update(r, n.node_id, (x) => ({ ...x, open: true }))); return; }
    setRoots((r) => r && update(r, n.node_id, (x) => ({ ...x, loading: true })));
    try {
      const kids = await load(n.node_id);
      void readLive(kids);
      setRoots((r) => r && update(r, n.node_id, (x) => ({ ...x, loading: false, open: true, children: kids })));
    } catch (e) {
      setErr(explain(e));
      setRoots((r) => r && update(r, n.node_id, (x) => ({ ...x, loading: false })));
    }
  };

  const pick = (n: Node) => setPicked((m) => { const c = new Map(m); if (c.has(n.node_id)) c.delete(n.node_id); else c.set(n.node_id, n); return c; });

  const add = async () => {
    setBusy(true); setErr('');
    try {
      await dsApi.bulkTags(orgId, edgeId, sourceId, tagsToCsv(browseToDrafts([...picked.values()], line.trim(), device.trim(), names)));
      onAdded();
    } catch (e) {
      const rows = e instanceof ApiError ? csvErrorsFromBody(e.body) : null;
      setErr(rows ? rows.map((r) => t('ds.rowErr', { row: r.row, field: r.field, message: r.message })).join('\n') : explain(e));
    } finally { setBusy(false); }
  };

  const render = (list: Node[], depth: number) => (
    <ul role={depth === 0 ? 'tree' : 'group'} className="text-[13px]">
      {list.map((n) => (
        <li key={n.node_id} role="treeitem" aria-expanded={isVar(n) ? undefined : !!n.open} aria-selected={picked.has(n.node_id)}>
          <div className="flex items-center gap-1 py-0.5" style={{ paddingLeft: depth * 16 }}>
            {isVar(n) ? (
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={picked.has(n.node_id)} onChange={() => pick(n)} />
                <span>{n.name}</span>
                <span className="font-mono text-[11px] text-ink-46">{n.data_type ?? ''}{n.writable ? ' · rw' : ''}</span>
                <LiveValue x={live.get(n.node_id)} />
              </label>
            ) : (
              <button type="button" className="flex items-center gap-1 hover:text-blue" onClick={() => void toggle(n)} aria-label={`${n.open ? t('ds.collapse') : t('ds.expand')} ${n.name}`}>
                <ChevronRight size={13} className={n.open ? 'rotate-90' : ''} aria-hidden />
                <span>{n.name}</span>
                {n.loading && <span className="text-[11px] text-ink-46">…</span>}
              </button>
            )}
          </div>
          {n.open && n.children && (n.children.length ? render(n.children, depth + 1) : <p className="py-0.5 text-[12px] italic text-ink-46" style={{ paddingLeft: (depth + 1) * 16 }}>{t('ds.emptyNode')}</p>)}
        </li>
      ))}
    </ul>
  );

  const ready = picked.size > 0 && normOk(line) && normOk(device);
  return (
    <section className="mt-3 rounded-[5px] border border-line bg-paper p-3" aria-label={t('ds.browseTitle')}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[14px] font-semibold">{t('ds.browseTitle')}</h3>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>{t('ds.close')}</button>
      </div>
      {roots === null ? (
        <button type="button" className="btn btn-sm" onClick={() => void start()} disabled={busy}>{busy ? t('ds.loading') : t('ds.browseStart')}</button>
      ) : (
        <>
          <div className="max-h-72 overflow-auto rounded border border-line p-2">{roots.length ? render(roots, 0) : <p className="text-[12px] italic text-ink-46">{t('ds.emptyNode')}</p>}</div>
          {picked.size > 0 && (
            <div className="mt-2 max-h-40 overflow-auto rounded border border-line p-2" aria-label={t('ds.namesTitle')}>
              <p className="mb-1 text-[11px] font-semibold uppercase text-ink-46">{t('ds.namesTitle')}</p>
              {[...picked.values()].map((n) => (
                <div key={n.node_id} className="flex items-center gap-2 py-0.5 text-[12px]">
                  <span className="w-40 truncate text-ink-68" title={n.node_id}>{n.name}</span>
                  <input className="input h-7 w-48 font-mono" aria-label={t('ds.signalFor', { name: n.name })}
                    value={names.get(n.node_id) ?? suggestSignal(n)}
                    onChange={(e) => setNames((m) => new Map(m).set(n.node_id, e.target.value))} />
                  <LiveValue x={live.get(n.node_id)} />
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <div>
              <label className="field-label" htmlFor="ob-line">{t('ds.f_line')}</label>
              <input id="ob-line" className="input h-8 w-36" value={line} onChange={(e) => setLine(e.target.value)} />
            </div>
            <div>
              <label className="field-label" htmlFor="ob-dev">{t('ds.f_device')}</label>
              <input id="ob-dev" className="input h-8 w-36" value={device} onChange={(e) => setDevice(e.target.value)} />
            </div>
            <button type="button" className="btn" disabled={!ready || busy} onClick={() => void add()}>{t('ds.addSelected', { count: picked.size })}</button>
          </div>
        </>
      )}
      {err && <div className="mt-2 whitespace-pre-line"><Notice tone="error">{err}</Notice></div>}
    </section>
  );
}

