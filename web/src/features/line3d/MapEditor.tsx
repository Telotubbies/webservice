// Plant model mapping editor (admin): upload a .glb, click equipment in the
// model, then say what it is (kind) and which site signals drive it. The
// mapping is stored with the model and read by the twin, the plan and the
// front view — nothing is hard-coded per plant.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../lib/api';
import {
  DEMO_MODEL_URL, DEMO_PARTS, plantApi,
  type Kinds, type ParamSpec, type PlantModel, type PlantPart, type PlantTag,
} from '../../lib/plantModel';
import { PageBar, Card } from '../../shared/ui/Page';
import { ErrorState, Skeleton } from '../../shared/ui/Feedback';
import { Icon } from '../../shared/ui/Icon';
import { Confirm } from '../../shared/ui/Confirm';
import { live } from '../../lib/live';
import { slug } from '../../lib/plantDetect';
import { bindSimTags, planSetup, type SetupPlan } from '../../lib/plantSetup';
import { PLANT_FOOTPRINT, type LineSceneView, type XrayMode } from './scene';

const why = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : '?');

function ParamField({ spec, value, onChange }: {
  spec: ParamSpec; value: unknown; onChange: (v: unknown) => void;
}) {
  const v = value ?? spec.default;
  if (spec.type === 'bool') {
    return <input type="checkbox" aria-label={spec.label} checked={!!v} onChange={(e) => onChange(e.target.checked)} />;
  }
  if (spec.type === 'enum') {
    return (
      <select className="input text-[11px]" aria-label={spec.label} value={String(v ?? '')} onChange={(e) => onChange(e.target.value)}>
        {(spec.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (spec.type === 'vec3') {
    const a = Array.isArray(v) ? (v as number[]) : [0, 0, 0];
    return (
      <span className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <input key={i} type="number" step="any" className="input w-14 text-[11px]" aria-label={`${spec.label} ${'xyz'[i]}`}
            value={a[i] ?? 0}
            onChange={(e) => { const n = [...a]; n[i] = Number(e.target.value) || 0; onChange(n); }} />
        ))}
      </span>
    );
  }
  return (
    <input type="number" step="any" className="input w-24 text-[11px]" aria-label={spec.label}
      min={spec.min} max={spec.max} value={typeof v === 'number' ? v : 0}
      onChange={(e) => onChange(Number(e.target.value) || 0)} />
  );
}

function NodeTree({ view, selected, onPick }: { view: LineSceneView; selected: number[]; onPick: (i: number) => void }) {
  // lazy tree: only expanded nodes render children (models have 10k+ nodes)
  const [open, setOpen] = useState<Set<number>>(new Set());
  const row = (i: number, depth: number): React.ReactNode => {
    const n = view.nodes[i];
    const isOpen = open.has(i);
    return (
      <li key={i}>
        <div className="flex items-center gap-1" style={{ paddingLeft: depth * 10 }}>
          {n.children.length > 0 ? (
            <button type="button" aria-label={n.name} aria-expanded={isOpen} className="h-4 w-4 text-ink-46"
              onClick={() => setOpen((s) => { const x = new Set(s); if (x.has(i)) x.delete(i); else x.add(i); return x; })}>
              <Icon name={isOpen ? 'chevron-down' : 'chevron'} size={12} />
            </button>
          ) : <span className="w-4" />}
          <button type="button" onClick={() => onPick(i)}
            className={`truncate rounded px-1 text-left text-[11px] ${selected.includes(i) ? 'bg-info-soft font-semibold text-blue' : 'text-ink-68 hover:bg-subtle'}`}>
            {n.name} <span className="text-ink-46">#{i}</span>
          </button>
        </div>
        {isOpen && n.children.length > 0 && (
          <ul>{n.children.slice(0, 300).map((c) => row(c, depth + 1))}</ul>
        )}
      </li>
    );
  };
  return <ul className="max-h-64 overflow-auto">{view.roots.slice(0, 300).map((r) => row(r, 0))}</ul>;
}

function PartCard({ part, kinds, tags, onChange, onRemove, onFocus, onZoom, onIsolate, missing }: {
  part: PlantPart; kinds: Kinds; tags: PlantTag[];
  onChange: (p: PlantPart) => void; onRemove: () => void; onFocus: () => void;
  onZoom: () => void; onIsolate: () => void; missing: boolean;
}) {
  const { t } = useTranslation();
  const kind = kinds[part.kind];
  return (
    <div className="rounded border border-line p-2" onFocus={onFocus} onMouseEnter={onFocus}>
      <div className="flex items-center gap-2">
        <input className="input flex-1" value={part.label} aria-label={t('plant.editor.label')}
          onChange={(e) => onChange({ ...part, label: e.target.value })} />
        <select className="input" value={part.kind} aria-label={t('plant.editor.kind')}
          onChange={(e) => onChange({ ...part, kind: e.target.value, bindings: {} })}>
          {Object.entries(kinds).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onRemove} aria-label={t('plant.editor.remove')}>
          <Icon name="x" size={12} />
        </button>
      </div>
      <div className="mt-1 flex items-center gap-1">
        <button type="button" className="btn btn-sm btn-ghost" onClick={onZoom}>{t('plant.editor.zoom')}</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onIsolate}>{t('plant.editor.isolate')}</button>
      </div>
      <p className="mt-1 text-[10px] text-ink-46">
        {t('plant.editor.nodesShort', { n: part.nodes.length })} #{part.nodes.slice(0, 6).join(', ')}{part.nodes.length > 6 ? '…' : ''}
        {missing && <span className="ml-2 text-warning">{t('plant.editor.missingNodes')}</span>}
      </p>
      {kind && (
        <dl className="mt-2 flex flex-col gap-1">
          {Object.entries(kind.roles).map(([role, spec]) => {
            const options = tags.filter((x) => x.type === spec.type && (!spec.writable || x.writable));
            return (
              <div key={role} className="flex items-center justify-between gap-2">
                <dt className="text-[11px] text-ink-68">{spec.label}{spec.writable && <span className="ml-1 text-[9px] uppercase text-ink-46">{t('plant.editor.writableOnly')}</span>}</dt>
                <dd>
                  <select className="input max-w-[220px] text-[11px]" aria-label={`${spec.label}`}
                    value={part.bindings[role] ?? ''}
                    onChange={(e) => {
                      const b = { ...part.bindings };
                      if (e.target.value) b[role] = e.target.value; else delete b[role];
                      onChange({ ...part, bindings: b });
                    }}>
                    <option value="">{t('plant.editor.unbound')}</option>
                    {options.map((x) => <option key={x.path} value={x.path}>{x.path}</option>)}
                    {part.bindings[role] && !options.some((x) => x.path === part.bindings[role]) && (
                      <option value={part.bindings[role]}>{part.bindings[role]} ⚠</option>
                    )}
                  </select>
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      {kind && Object.keys(kind.params).length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] font-semibold text-ink-68">{t('plant.editor.motion')}</summary>
          <dl className="mt-1 flex flex-col gap-1">
            {Object.entries(kind.params).map(([key, spec]) => (
              <div key={key} className="flex items-center justify-between gap-2">
                <dt className="text-[11px] text-ink-68">{spec.label}</dt>
                <dd>
                  <ParamField spec={spec} value={part.params?.[key]}
                    onChange={(v) => onChange({ ...part, params: { ...part.params, [key]: v } })} />
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  );
}

export function MapEditor() {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<LineSceneView | null>(null);
  const [models, setModels] = useState<PlantModel[] | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);   // null = bundled demo
  const [kinds, setKinds] = useState<Kinds>({});
  const [tags, setTags] = useState<PlantTag[]>([]);
  const [parts, setParts] = useState<PlantPart[]>([]);
  const [dirty, setDirty] = useState(false);
  const [sel, setSel] = useState<number[]>([]);       // selected node indices
  const [chain, setChain] = useState<number[]>([]);   // hit -> root, for "select parent"
  const [chainAt, setChainAt] = useState(0);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [confirmDel, setConfirmDel] = useState<PlantModel | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState(false);
  const [xray, setXray] = useState<XrayMode>('off');
  const [isolated, setIsolated] = useState<string | null>(null);
  const [plan, setPlan] = useState<SetupPlan | null>(null);
  const [skip, setSkip] = useState<Set<string>>(new Set());   // candidate labels the user unticked
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const live3 = useRef({ preview: false, focusKey: null as string | null });
  useEffect(() => { live3.current = { preview, focusKey }; }, [preview, focusKey]);

  const reloadModels = useCallback(async (prefer?: string) => {
    const list = await plantApi.list();
    setModels(list);
    setModelId((cur) => prefer ?? (cur && list.some((m) => m.id === cur) ? cur : (list.find((m) => m.active) ?? list[0])?.id ?? null));
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [k, tg] = await Promise.all([plantApi.kinds(), plantApi.tags()]);
        setKinds(k); setTags(tg);
        await reloadModels();
      } catch { setLoadErr(true); }
    })();
  }, [reloadModels]);

  // (re)build the scene whenever the edited model changes
  useEffect(() => {
    if (models === null || !canvasRef.current) return;
    let dead = false;
    let v: LineSceneView | null = null;
    let raf = 0;
    let ro: ResizeObserver | null = null;
    let objectUrl = '';
    setView(null); setSel([]); setChain([]); setMsg(null); setDirty(false);
    void (async () => {
      try {
        let url = DEMO_MODEL_URL;
        let loaded: PlantPart[] = DEMO_PARTS;
        if (modelId) {
          const got = await plantApi.get(modelId);
          url = objectUrl = await plantApi.fileUrl(modelId);
          loaded = got.parts;
        }
        if (dead) return;
        const { buildScene, applyState } = await import('./scene');
        const built = await buildScene(canvasRef.current!, { url, parts: [] });
        if (dead) { built.dispose(); return; }
        v = built;
        const host = canvasRef.current!.parentElement!;
        const size = () => v?.setSize(host.clientWidth, host.clientHeight);
        size();
        ro = new ResizeObserver(size);
        ro.observe(host);
        const tick = (now: number, last: number) => {
          if (v) applyState(v, live, { preview: live3.current.preview, selected: live3.current.focusKey });
          v?.tick(now - last);
          raf = requestAnimationFrame((n) => tick(n, now)); };
        raf = requestAnimationFrame((n) => tick(n, n));
        setParts(loaded);
        setView(built);
      } catch { if (!dead) setLoadErr(true); }
    })();
    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      v?.dispose();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [models === null, modelId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { view?.highlight(sel.length ? sel : null); }, [view, sel]);
  useEffect(() => { view?.setParts(parts); }, [view, parts]);
  useEffect(() => { view?.setXray(xray, null); }, [view, xray]);
  useEffect(() => { view?.isolate(isolated); }, [view, isolated]);

  const nodeInput = () => view && ({
    nodes: view.nodes, roots: view.roots, nodeBox: view.nodeBox.bind(view), footprint: PLANT_FOOTPRINT,
  });

  const runDetect = async () => {
    const inp = nodeInput();
    if (!inp) return;
    const p = planSetup(inp, kinds, tags, parts);
    if (!p.candidates.length) { setMsg({ kind: 'err', text: t('plant.editor.nothingFound') }); return; }
    setSkip(new Set()); setPlan(p); setMsg(null);
  };

  const applyPlan = async () => {
    const inp = nodeInput();
    if (!plan || !inp) return;
    setBusy(true); setMsg(null);
    try {
      // re-plan with only the ticked candidates so unticked ones create nothing
      const keepIdx = new Set(plan.parts.slice(parts.length).map((p, i) => (skip.has(p.label) ? -1 : i)).filter((i) => i >= 0));
      const chosen = plan.parts.slice(parts.length).filter((_, i) => keepIdx.has(i));
      const base = [...parts, ...chosen];
      const have = new Set(tags.map((x) => x.path));
      const dropped = plan.parts.slice(parts.length).filter((p) => skip.has(p.label)).map((p) => `auto/${slug(p.label)}/`);
      const defs = plan.simTags.filter((d) => !have.has(d.path) && !dropped.some((d0) => d.path.startsWith(d0)));
      const res = defs.length ? await plantApi.createSimTags(defs) : { created: [], existing: [] };
      const fresh = res.created.length ? await plantApi.tags() : tags;
      if (res.created.length) setTags(fresh);
      // a tag from an earlier run may be read-only where the role needs a writable one
      const usable = new Set(plan.simTags
        .filter((d) => fresh.some((x) => x.path === d.path && (!d.writable || x.writable)))
        .map((d) => d.path));
      const next = bindSimTags(base, kinds, usable, parts.length, inp);
      setParts(next); setDirty(true);
      setPlan(null);
      setMsg({ kind: 'ok', text: t('plant.editor.setupDone', { parts: chosen.length, tags: res.created.length }) });
    } catch (e) { setMsg({ kind: 'err', text: t('plant.editor.errors.save', { why: why(e) }) }); }
    finally { setBusy(false); }
  };

  const onCanvasClick = (e: React.MouseEvent) => {
    const c = view?.pickNodeChain(e.clientX, e.clientY);
    if (!c) { setChain([]); setSel([]); return; }
    setChain(c); setChainAt(0); setSel([c[0]]);
  };

  const parentOfSel = () => {
    if (chain.length && chainAt + 1 < chain.length) { setChainAt(chainAt + 1); setSel([chain[chainAt + 1]]); }
    else if (sel.length === 1 && view && view.nodes[sel[0]]?.parent >= 0) setSel([view.nodes[sel[0]].parent]);
  };

  const addPartFromSel = () => {
    if (!sel.length) { setMsg({ kind: 'err', text: t('plant.editor.noSelection') }); return; }
    const base = view?.nodes[sel[0]]?.name ?? 'Part';
    let label = base, n = 2;
    while (parts.some((p) => p.label === label)) label = `${base} ${n++}`;
    setParts([...parts, { label, kind: 'indicator', nodes: [...sel].sort((a, b) => a - b), bindings: {} }]);
    setDirty(true); setMsg(null);
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setMsg(null);
    try {
      const m = await plantApi.upload(file);
      await reloadModels(m.id);
    } catch (e) { setMsg({ kind: 'err', text: t('plant.editor.errors.upload', { why: why(e) }) }); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const saveDemoAsMine = async () => {
    setBusy(true); setMsg(null);
    try {
      const blob = await (await fetch(DEMO_MODEL_URL)).blob();
      const m = await plantApi.upload(new File([blob], 'centrale-beton.glb', { type: 'model/gltf-binary' }), 'Centrale à béton');
      await plantApi.putParts(m.id, DEMO_PARTS.filter((p) => Object.values(p.bindings).every((path) => tags.some((x) => x.path === path))));
      await reloadModels(m.id);
    } catch (e) { setMsg({ kind: 'err', text: t('plant.editor.errors.upload', { why: why(e) }) }); }
    finally { setBusy(false); }
  };

  const save = async () => {
    if (!modelId) return;
    setBusy(true); setMsg(null);
    try {
      setParts(await plantApi.putParts(modelId, parts));
      setDirty(false);
      setMsg({ kind: 'ok', text: t('plant.editor.saved') });
      await reloadModels(modelId);
    } catch (e) { setMsg({ kind: 'err', text: t('plant.editor.errors.save', { why: why(e) }) }); }
    finally { setBusy(false); }
  };

  const activeModel = models?.find((m) => m.id === modelId) ?? null;
  const nodeCount = view?.nodes.length ?? 0;
  const missing = useMemo(() => new Set(parts.map((p, i) => (p.nodes.some((n) => n >= nodeCount) ? i : -1)).filter((i) => i >= 0)), [parts, nodeCount]);

  if (loadErr) return <><PageBar title={t('plant.editor.title')} /><ErrorState onRetry={() => window.location.reload()} /></>;

  return (
    <>
      <PageBar title={t('plant.editor.title')} lede={t('plant.editor.lede')}
        actions={
          <div className="flex items-center gap-2">
            {dirty && <span className="text-[11px] text-warning">{t('plant.editor.dirty')}</span>}
            <button className="btn btn-sm" disabled={!modelId || !dirty || busy} onClick={() => void save()}>
              <Icon name="check" size={13} /> {t('plant.editor.save')}
            </button>
          </div>
        } />
      <div className="grid h-[calc(100svh-88px)] gap-3 p-4 lg:grid-cols-[1fr_380px]">
        <div className="relative min-h-[320px] overflow-hidden rounded-[5px] border border-line bg-white shadow-card">
          {!view && <div className="absolute inset-0 grid place-items-center"><Skeleton w={220} h={20} /></div>}
          <canvas ref={canvasRef} className="h-full w-full cursor-crosshair" aria-label={t('line3d.canvasLabel')} onClick={onCanvasClick} />
          <div className="absolute left-3 top-3 flex flex-wrap items-center gap-1 rounded border border-line bg-white/90 p-1">
            <button type="button" className="btn btn-sm" disabled={!view || busy} onClick={() => void runDetect()}>
              <Icon name="check" size={13} /> {t('plant.editor.autoSetup')}
            </button>
            <button type="button" aria-pressed={preview} className={`btn btn-sm ${preview ? '' : 'btn-ghost'}`} onClick={() => setPreview((v) => !v)}>
              {t('plant.editor.preview')}
            </button>
            <button type="button" aria-pressed={xray !== 'off'} className={`btn btn-sm ${xray !== 'off' ? '' : 'btn-ghost'}`}
              onClick={() => setXray((m) => (m === 'off' ? 'all' : 'off'))}>
              {t('plant.editor.xray')}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" disabled={!isolated} onClick={() => setIsolated(null)}>
              {t('plant.editor.showAll')}
            </button>
          </div>
          <p className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-ink-46">{t('plant.editor.pickHint')}</p>
        </div>

        <div className="flex min-h-0 flex-col gap-3 overflow-auto">
          {plan && (
            <Card title={t('plant.editor.review', { n: plan.candidates.length })}>
              <p className="mb-2 text-[11px] text-ink-46">
                {t('plant.editor.reviewHint', { bound: plan.boundCount, tags: plan.simTags.length })}
              </p>
              <ul className="mb-2 flex max-h-56 flex-col gap-1 overflow-auto">
                {plan.parts.slice(parts.length).map((p) => {
                  const cand = plan.candidates.find((c) => c.nodes === p.nodes);
                  return (
                    <li key={p.label} className="flex items-center gap-2 text-[11px]">
                      <input type="checkbox" aria-label={p.label} checked={!skip.has(p.label)}
                        onChange={() => setSkip((s) => { const x = new Set(s); if (x.has(p.label)) x.delete(p.label); else x.add(p.label); return x; })} />
                      <span className="flex-1 truncate">{p.label}</span>
                      <span className="text-ink-46">{kinds[p.kind]?.label ?? p.kind}</span>
                      {cand && <span className={`rounded px-1 text-[9px] uppercase ${cand.conf === 'high' ? 'bg-info-soft text-blue' : 'bg-subtle text-ink-68'}`}>{cand.conf}</span>}
                    </li>
                  );
                })}
              </ul>
              <div className="flex gap-2">
                <button className="btn btn-sm" disabled={busy} onClick={() => void applyPlan()}>{t('plant.editor.apply')}</button>
                <button className="btn btn-sm btn-ghost" onClick={() => setPlan(null)}>{t('plant.editor.cancel')}</button>
              </div>
            </Card>
          )}

          <Card title={t('plant.editor.models')}>
            <div className="flex flex-col gap-2">
              <input ref={fileRef} type="file" accept=".glb,model/gltf-binary" hidden
                onChange={(e) => void upload(e.target.files?.[0])} />
              <button className="btn btn-sm justify-center" disabled={busy} onClick={() => fileRef.current?.click()}>
                <Icon name="plus" size={13} /> {busy ? t('plant.editor.uploading') : t('plant.editor.upload')}
              </button>
              {models && models.length === 0 && (
                <>
                  <p className="text-[12px] text-ink-46">{t('plant.editor.none')}</p>
                  <button className="btn btn-sm btn-ghost justify-center" disabled={busy || tags.length === 0} onClick={() => void saveDemoAsMine()}>
                    {t('plant.editor.saveDemo')}
                  </button>
                </>
              )}
              <ul className="flex flex-col gap-1">
                {models?.map((m) => (
                  <li key={m.id} className={`flex items-center gap-2 rounded border px-2 py-1 text-[12px] ${m.id === modelId ? 'border-blue' : 'border-line'}`}>
                    <button type="button" className="flex-1 truncate text-left" onClick={() => setModelId(m.id)}>
                      {m.name} <span className="text-ink-46">· {m.node_count} · {(m.size_bytes / 1048576).toFixed(1)} MB</span>
                    </button>
                    {m.active
                      ? <span className="rounded bg-info-soft px-1.5 text-[10px] font-bold uppercase text-blue">{t('plant.editor.active')}</span>
                      : <button type="button" className="btn btn-sm btn-ghost" disabled={busy}
                          onClick={() => void plantApi.activate(m.id).then(() => reloadModels(m.id)).catch((e) => setMsg({ kind: 'err', text: why(e) }))}>
                          {t('plant.editor.activate')}
                        </button>}
                    <button type="button" className="btn btn-sm btn-ghost" aria-label={t('plant.editor.remove')} onClick={() => setConfirmDel(m)}>
                      <Icon name="x" size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </Card>

          <Card title={t('plant.editor.selection')}>
            {sel.length === 0 ? <p className="text-[12px] text-ink-46">{t('plant.editor.noSelection')}</p> : (
              <div className="flex flex-col gap-2">
                <p className="text-[12px]">{t('plant.editor.nodes', { n: sel.length })} — <span className="font-mono">{view?.nodes[sel[0]]?.name}</span></p>
                <div className="flex flex-wrap gap-1">
                  <button className="btn btn-sm btn-ghost" onClick={parentOfSel}>{t('plant.editor.parent')}</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setSel([])}>{t('plant.editor.clear')}</button>
                  <button className="btn btn-sm" onClick={addPartFromSel} disabled={!modelId}>{t('plant.editor.addPart')}</button>
                </div>
              </div>
            )}
            {view && (
              <details className="mt-3">
                <summary className="cursor-pointer text-[11px] font-semibold text-ink-68">{t('plant.editor.tree')}</summary>
                <NodeTree view={view} selected={sel} onPick={(i) => { setChain([]); setSel([i]); }} />
              </details>
            )}
          </Card>

          <Card title={`${t('plant.editor.parts')} (${parts.length})`}>
            {!modelId && <p className="mb-2 text-[11px] text-ink-46">{t('plant.editor.none')}</p>}
            <div className="flex flex-col gap-2">
              {parts.map((p, i) => (
                <PartCard key={`${i}-${p.label}`} part={p} kinds={kinds} tags={tags} missing={missing.has(i)}
                  onFocus={() => { view?.highlight(p.nodes); setFocusKey(String(i)); }}
                  onZoom={() => view?.focus(String(i))}
                  onIsolate={() => setIsolated((c) => (c === String(i) ? null : String(i)))}
                  onChange={(np) => { setParts(parts.map((x, j) => (j === i ? np : x))); setDirty(true); }}
                  onRemove={() => { setParts(parts.filter((_, j) => j !== i)); setDirty(true); }} />
              ))}
            </div>
          </Card>
          {msg && <p className={`notice ${msg.kind === 'ok' ? 'notice-ok' : 'notice-error'}`} role={msg.kind === 'err' ? 'alert' : 'status'}>{msg.text}</p>}
          {activeModel && !activeModel.active && <p className="text-[11px] text-ink-46">{t('plant.editor.activate')}?</p>}
        </div>
      </div>
      {confirmDel && (
        <Confirm title={`${t('plant.editor.remove')}: ${confirmDel.name}`} body={t('plant.editor.removeBody')}
          confirm={t('plant.editor.remove')}
          onYes={() => {
            const m = confirmDel; setConfirmDel(null);
            void plantApi.remove(m.id).then(() => { if (m.id === modelId) setModelId(null); return reloadModels(); })
              .catch((e) => setMsg({ kind: 'err', text: why(e) }));
          }}
          onNo={() => setConfirmDel(null)} />
      )}
    </>
  );
}
