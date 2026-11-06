// Plant board page body (a mode of the twin page). Builds the board on first
// open from side captures of the 3D parts, lets an admin edit and keep drafts,
// publish and roll back versions. Nothing here writes to the PLC.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { canAdmin, useRole } from '../../app/session';
import { Skeleton } from '../../shared/ui/Feedback';
import {
  autoLayout, deriveGroups, deriveLinks, fillMissing, mappingIssues, moveItem, nudgeItem, partKey,
  resizeItem, setFlag, toggleLink, type BoardLayout,
} from './boardLayout';
import { boardApi, DEMO_SHA, type BoardState } from './boardApi';
import { toPartBoxes, type PartCapture } from './boardCapture';
import { BoardView } from './BoardView';
import type { SceneSource } from './useSceneSource';
import './i18n';

const capCache = new Map<string, PartCapture[]>();
const HISTORY = 50;

export function BoardPage({ src }: { src: SceneSource }) {
  const { t } = useTranslation();
  const admin = canAdmin(useRole());
  const sha = src.model?.sha256 ?? DEMO_SHA;
  const plantName = src.model?.name ?? t('board.demoPlant');
  const parts = src.parts;

  const [phase, setPhase] = useState<'loading' | 'capturing' | 'ready' | 'error'>('loading');
  const [caps, setCaps] = useState<PartCapture[]>([]);
  const [layout, setLayout] = useState<BoardLayout | null>(null);
  const [past, setPast] = useState<BoardLayout[]>([]);
  const [server, setServer] = useState<BoardState | null>(null);
  const [savedJson, setSavedJson] = useState('');
  const [built, setBuilt] = useState(false);
  const [edit, setEdit] = useState(false);
  const [color, setColor] = useState(false);
  const [linkTool, setLinkTool] = useState(false);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [pickVersion, setPickVersion] = useState('');

  const capMap = useMemo(() => Object.fromEntries(caps.map((c) => [c.key, c])), [caps]);
  const boxes = useMemo(() => toPartBoxes(caps), [caps]);
  const groups = useMemo(() => deriveGroups(parts), [parts]);
  const derived = useMemo(() => deriveLinks(parts, boxes), [parts, boxes]);

  const start = useCallback((list: PartCapture[], st: BoardState | null) => {
    const bx = toPartBoxes(list), gr = deriveGroups(parts);
    const base = admin ? (st?.draft ?? st?.published) : st?.published;
    const lay = base ? fillMissing(base.layout, parts, bx, gr) : autoLayout(null, parts, bx, gr);
    setCaps(list); setLayout(lay); setPast([]); setServer(st);
    setSavedJson(base ? JSON.stringify(base.layout) : JSON.stringify(lay));
    setBuilt(!base); setPhase('ready');
  }, [parts, admin]);

  const capture = useCallback(async () => {
    const { capturePartImages } = await import('./boardCapture');
    const list = await capturePartImages(src.url, parts);
    capCache.set(sha, list);
    return list;
  }, [src.url, parts, sha]);

  useEffect(() => {
    if (src.status !== 'ready') return;
    let dead = false;
    setPhase('loading'); setMsg('');
    void (async () => {
      try {
        const [st, stored] = await Promise.all([boardApi.get(sha).catch(() => null), boardApi.captures(sha).catch(() => [])]);
        let list = stored.length ? stored : capCache.get(sha) ?? [];
        if (list.length === 0) {
          setPhase('capturing');
          list = await capture();
          if (admin) await boardApi.saveCaptures(sha, list).catch(() => undefined);
        }
        if (!dead) start(list, st);
      } catch {
        if (!dead) setPhase('error');
      }
    })();
    return () => { dead = true; };
  }, [src.status, sha, attempt, admin, capture, start]);

  const dirty = layout ? JSON.stringify(layout) !== savedJson : false;
  const push = () => { if (layout) setPast((p) => [...p.slice(-(HISTORY - 1)), layout]); };
  const apply = (fn: (l: BoardLayout) => BoardLayout) => { if (!layout) return; push(); setLayout(fn(layout)); };
  const undo = () => { const l = past[past.length - 1]; if (l) { setLayout(l); setPast(past.slice(0, -1)); } };

  const failMsg = () => setMsg(t('board.saveFail'));
  const save = async () => {
    if (!layout) return null;
    setBusy(true); setMsg(t('board.saving'));
    try {
      const d = await boardApi.saveDraft(sha, src.model?.id ?? null, layout);
      setSavedJson(JSON.stringify(layout));
      setServer((s) => ({ draft: d, published: s?.published ?? null, versions: s?.versions ?? [] }));
      setMsg(t('board.savedDraft'));
      return d;
    } catch { failMsg(); return null; } finally { setBusy(false); }
  };
  const publish = async () => {
    if (dirty || !server?.draft) { if (!(await save())) return; }
    setBusy(true);
    try {
      const pub = await boardApi.publish(sha);
      setServer(await boardApi.get(sha));
      setMsg(t('board.published', { v: pub.version }));
    } catch { failMsg(); } finally { setBusy(false); }
  };
  const rollback = async () => {
    const v = Number(pickVersion);
    if (!v) return;
    setBusy(true);
    try {
      const pub = await boardApi.rollback(sha, v);
      const st = await boardApi.get(sha);
      setServer(st);
      setLayout(fillMissing(pub.layout, parts, boxes, groups)); setPast([]);
      setSavedJson(JSON.stringify(pub.layout));
      setMsg(t('board.rolledBack', { v: pub.version }));
    } catch { failMsg(); } finally { setBusy(false); }
  };
  const recapture = async () => {
    setBusy(true); setMsg(t('board.capturing'));
    try {
      capCache.delete(sha);
      const list = await capture();
      await boardApi.saveCaptures(sha, list);
      const bx = toPartBoxes(list);
      setCaps(list);
      if (layout) { push(); setLayout(fillMissing(layout, parts, bx, groups)); }
      setMsg('');
    } catch { failMsg(); } finally { setBusy(false); }
  };

  const onLinkPick = (key: string) => {
    if (!layout) return;
    if (!linkFrom) { setLinkFrom(key); return; }
    apply((l) => toggleLink(l, derived.links, linkFrom, key));
    setLinkFrom(null);
  };

  if (src.status === 'error' || phase === 'error') {
    return (
      <div className="m-4 rounded border border-line bg-paper p-4 text-[13px]" role="alert">
        {t('board.failed')} <button type="button" className="btn btn-sm ml-2" onClick={() => setAttempt((n) => n + 1)}>{t('board.retry')}</button>
      </div>
    );
  }
  if (phase !== 'ready' || !layout) {
    return (
      <div className="m-4 grid min-h-[240px] place-items-center rounded border border-line bg-paper p-4" role="status">
        <div className="text-center text-[13px] text-ink-68">
          <Skeleton w={220} h={20} />
          <p className="mt-3">{phase === 'capturing' ? t('board.capturing') : t('board.loading')}</p>
        </div>
      </div>
    );
  }

  const item = sel ? layout.items[sel] : undefined;
  const selPart = sel ? parts.find((p) => partKey(p) === sel) : undefined;
  const hidden = Object.values(layout.items).filter((i) => i.hidden).length;
  const issues = mappingIssues(parts, capMap, layout);
  const missing = Object.values(issues).filter((v) => v === 'missing').length;
  const label = (k: string) => parts.find((p) => partKey(p) === k)?.label ?? k;
  const when = (iso: string) => new Date(iso).toLocaleString();
  const pub = server?.published;
  const status = dirty ? t('board.unsaved') : server?.draft ? t('board.savedDraft') : pub ? t('board.published', { v: pub.version }) : t('board.notPublished');

  return (
    <div className="flex flex-col gap-3 p-4" data-testid="plant-board">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[15px] font-semibold text-ink" data-testid="board-plant">{plantName}</h2>
        {src.model && <span className="font-mono text-[11px] text-ink-46">{sha.slice(0, 8)}</span>}
        <p className="text-[12px] text-ink-68">{t('board.lede')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label={t('board.title')}>
        {admin && (
          <div className="flex overflow-hidden rounded border border-line" role="group">
            {[false, true].map((e) => (
              <button key={String(e)} type="button" aria-pressed={edit === e} onClick={() => { setEdit(e); setLinkTool(false); setLinkFrom(null); }}
                className={`h-7 px-2.5 text-[11px] font-semibold ${edit === e ? 'bg-info-soft text-blue' : 'text-ink-68 hover:bg-subtle'}`}>
                {e ? t('board.edit') : t('board.view')}
              </button>
            ))}
          </div>
        )}
        <button type="button" className="btn btn-sm btn-ghost" aria-pressed={color} onClick={() => setColor((c) => !c)}>
          {color ? t('board.grey') : t('board.color')}
        </button>
        {edit && (
          <>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => apply((l) => autoLayout(l, parts, boxes, groups))}>{t('board.auto')}</button>
            <button type="button" className="btn btn-sm btn-ghost" disabled={past.length === 0} onClick={undo}>{t('board.undo')}</button>
            <button type="button" className="btn btn-sm btn-ghost" aria-pressed={linkTool} onClick={() => { setLinkTool((v) => !v); setLinkFrom(null); }}>
              {linkTool ? t('board.linkOn') : t('board.link')}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void recapture()}>{t('board.recapture')}</button>
            <button type="button" className="btn btn-sm" disabled={busy || (!dirty && !!server?.draft)} onClick={() => void save()}>{t('board.save')}</button>
            <button type="button" className="btn btn-sm" disabled={busy || (!dirty && !server?.draft)} onClick={() => void publish()}>{t('board.publish')}</button>
          </>
        )}
        {hidden > 0 && (
          <button type="button" className="btn btn-sm btn-ghost" aria-pressed={showHidden} onClick={() => setShowHidden((v) => !v)}>
            {showHidden ? t('board.hiddenCount', { n: hidden }) : t('board.show')}
          </button>
        )}
        <span className="text-[12px] text-ink-68" role="status" data-testid="board-status">{msg && !dirty ? msg : status}</span>
      </div>

      {edit && linkTool && <p className="text-[12px] text-ink-68">{t('board.linkHint')}{linkFrom ? ` ${label(linkFrom)}` : ''}</p>}
      {built && <p className="rounded border border-line bg-subtle px-3 py-2 text-[12px] text-ink-68">{t('board.firstBuilt')}</p>}
      {!admin && <p className="text-[12px] text-ink-46">{t('board.viewerNote')}</p>}
      {missing > 0 && <p className="text-[12px] text-ink-68">{t('board.noPictures', { n: missing })}</p>}

      <div className="rounded-[5px] border border-line bg-paper shadow-card">
        <BoardView plantName={plantName} parts={parts} layout={layout} caps={capMap} derived={derived} color={color}
          edit={edit} linkTool={linkTool} sel={sel} showHidden={showHidden} onSelect={setSel}
          onDragStart={push} onMove={(k, x, y) => setLayout((l) => (l ? moveItem(l, k, x, y) : l))}
          onNudge={(k, dx, dy, fine) => apply((l) => nudgeItem(l, k, dx, dy, fine ? 1 : undefined))}
          onLinkPick={onLinkPick} />
      </div>

      {edit && (
        <div className="flex flex-wrap items-center gap-3 rounded border border-line bg-paper p-3 text-[12px]" data-testid="board-inspector">
          {selPart && item ? (
            <>
              <strong>{t('board.selected', { name: selPart.label })}</strong>
              <button type="button" className="btn btn-sm btn-ghost" aria-pressed={!!item.locked}
                onClick={() => apply((l) => setFlag(l, sel!, 'locked', !item.locked))}>
                {item.locked ? t('board.unlock') : t('board.lock')}
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => apply((l) => setFlag(l, sel!, 'hidden', !item.hidden))}>
                {item.hidden ? t('board.show') : t('board.hide')}
              </button>
              {(['w', 'h'] as const).map((f) => (
                <label key={f} className="flex items-center gap-1">
                  {t(f === 'w' ? 'board.width' : 'board.height')}
                  <input type="number" className="input w-20 text-[12px]" value={Math.round(item[f])} min={30} max={400} step={2} disabled={!!item.locked}
                    onChange={(e) => apply((l) => resizeItem(l, sel!, f === 'w' ? Number(e.target.value) : l.items[sel!].w, f === 'h' ? Number(e.target.value) : l.items[sel!].h))} />
                </label>
              ))}
              {item.locked && <span className="text-ink-46">{t('board.lockedHint')}</span>}
            </>
          ) : <span className="text-ink-68">{t('board.none')}</span>}
        </div>
      )}

      {edit && (server?.versions.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <label htmlFor="board-ver">{t('board.versions')}</label>
          <select id="board-ver" className="input text-[12px]" value={pickVersion} onChange={(e) => setPickVersion(e.target.value)}>
            <option value="" />
            {server!.versions.map((v) => <option key={v.version} value={v.version}>{t('board.versionOpt', { v: v.version, when: when(v.created_at) })}</option>)}
          </select>
          <button type="button" className="btn btn-sm btn-ghost" disabled={busy || !pickVersion} onClick={() => void rollback()}>{t('board.rollback')}</button>
        </div>
      )}

      {Object.keys(issues).length > 0 && (
        <details className="text-[12px] text-ink-68">
          <summary className="cursor-pointer">{t('board.issues')} ({Object.keys(issues).length})</summary>
          <ul className="mt-1 list-disc pl-5">
            {Object.entries(issues).map(([k, v]) => <li key={k}>{label(k)}: {t(`board.issue_${v}`)}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}
