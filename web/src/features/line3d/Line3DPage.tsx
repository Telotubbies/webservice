// Plant twin — the site's .glb (or the bundled demo) in 3D, plus a 2D plan
// and front elevation derived from the same model, all driven by the
// operator's node→equipment mapping. Lazy three.js scene bound to the live
// store: buildScene returns a view handle; applyState shades parts on each
// store flush.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { live } from '../../lib/live';
import { useStore } from '../../lib/hooks';
import { canAdmin, useRole } from '../../app/session';
import { PageBar, Card } from '../../shared/ui/Page';
import { ErrorState, Skeleton } from '../../shared/ui/Feedback';
import { Icon } from '../../shared/ui/Icon';
import type { LineSceneView, PlanImage, PlanKind, XrayMode } from './scene';
import { PartPanel } from './PartPanel';
import { PlanView } from './PlantPlan';
import { useSceneSource } from './useSceneSource';

type Mode = '3d' | 'top' | 'front';

export function Line3DPage() {
  const { t } = useTranslation();
  const role = useRole();
  const src = useSceneSource();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<LineSceneView | null>(null);
  const applyRef = useRef<typeof import('./scene').applyState | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [sceneView, setSceneView] = useState<LineSceneView | null>(null);
  const [fail, setFail] = useState(false);
  const [mode, setMode] = useState<Mode>('3d');
  const [xray, setXray] = useState<XrayMode>('off');
  const [isolated, setIsolated] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [plans, setPlans] = useState<Partial<Record<PlanKind, PlanImage>>>({});
  const ver = useStore(() => live.version);
  const reduced = useMemo(() => matchMedia('(prefers-reduced-motion: reduce)').matches, []);

  useEffect(() => {
    if (src.status !== 'ready') return;
    let dead = false;
    let view: LineSceneView | null = null;
    let raf = 0;
    let ro: ResizeObserver | null = null;
    setReady(false); setFail(false); setPlans({}); setSel(null);
    void import('./scene').then(({ buildScene, applyState }) => {
      if (dead || !canvasRef.current) return;
      return buildScene(canvasRef.current, { url: src.url, parts: src.parts }).then((v) => {
        if (dead) { v.dispose(); return; }
        view = v;
        viewRef.current = v;
        applyRef.current = applyState;
        const host = canvasRef.current!.parentElement!;
        const size = () => view?.setSize(host.clientWidth, host.clientHeight);
        size();
        ro = new ResizeObserver(size);
        ro.observe(host);
        const tick = (now: number, last: number) => {
          view?.tick(now - last);
          raf = requestAnimationFrame((n) => tick(n, now));
        };
        raf = requestAnimationFrame((n) => tick(n, n));
        setSceneView(v);
        setReady(true);
        applyState(v, live, { reduceMotion: reduced });
      });
    }).catch(() => { if (!dead) setFail(true); });
    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      view?.dispose();
      viewRef.current = null;
      setSceneView(null);
    };
  }, [src.status, src.url, src.parts, reduced]);

  // shade the scene on every live flush
  useEffect(() => {
    const v = viewRef.current;
    if (v && applyRef.current) applyRef.current(v, live, { selected: sel, reduceMotion: reduced });
  }, [ver, sel, ready, reduced]);

  // view tools: X-ray / isolate act on the scene handle
  useEffect(() => { sceneView?.setXray(xray, null); }, [sceneView, xray]);
  useEffect(() => { sceneView?.isolate(isolated); }, [sceneView, isolated]);

  // 2D views are rendered once per kind from the loaded scene
  useEffect(() => {
    const v = viewRef.current;
    if (mode === '3d' || !ready || !v || plans[mode]) return;
    setPlans((p) => ({ ...p, [mode]: v.plan(mode, 1800) }));
  }, [mode, ready, plans]);

  const pick = (e: React.MouseEvent) => {
    const v = viewRef.current;
    if (!v) return;
    // pick() expects CLIENT coordinates — it resolves the canvas rect itself
    setSel(v.pick(e.clientX, e.clientY));
  };

  const part = sel !== null ? src.parts[Number(sel)] : undefined;
  const failed = src.status === 'error' || fail;

  return (
    <>
      <PageBar
        title={t('plant.title')}
        lede={t('plant.lede')}
        actions={
          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded border border-line" role="group" aria-label={t('plant.view')}>
              {(['3d', 'top', 'front'] as Mode[]).map((m) => (
                <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
                  className={`h-7 px-2.5 text-[11px] font-semibold ${mode === m ? 'bg-info-soft text-blue' : 'text-ink-68 hover:bg-subtle'}`}>
                  {t(`plant.mode.${m}`)}
                </button>
              ))}
            </div>
            <button type="button" aria-pressed={xray !== 'off'} disabled={mode !== '3d'}
              className={`btn btn-sm ${xray !== 'off' ? '' : 'btn-ghost'}`}
              onClick={() => setXray((m) => (m === 'off' ? 'all' : 'off'))}>
              {t('plant.editor.xray')}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" disabled={mode !== '3d' || sel === null}
              onClick={() => viewRef.current?.focus(sel)}>
              {t('plant.editor.zoom')}
            </button>
            <button type="button" aria-pressed={isolated !== null} className={`btn btn-sm ${isolated !== null ? '' : 'btn-ghost'}`}
              disabled={mode !== '3d' || (sel === null && isolated === null)}
              onClick={() => setIsolated((c) => (c !== null ? null : sel))}>
              {isolated !== null ? t('plant.editor.showAll') : t('plant.editor.isolate')}
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => viewRef.current?.resetView()} disabled={mode !== '3d'}>
              <Icon name="refresh" size={13} /> {t('line3d.resetView')}
            </button>
            {canAdmin(role) && (
              <Link to="/line3d/map" className="btn btn-sm">
                <Icon name="tag" size={13} /> {t('plant.editMapping')}
              </Link>
            )}
          </div>
        }
      />
      {src.status === 'ready' && !src.model && (
        <p className="mx-4 mt-3 rounded border border-line bg-subtle px-3 py-2 text-[12px] text-ink-68">
          {t('plant.demoBanner')}
        </p>
      )}
      <div className="flex h-[calc(100svh-88px)] gap-3 p-4">
        <div className="relative h-full min-w-0 flex-1 overflow-hidden rounded-[5px] border border-line bg-white shadow-card">
          {failed ? (
            <ErrorState onRetry={() => { setFail(false); setReady(false); src.reload(); }} />
          ) : (
            <>
              {!ready && (
                <div className="absolute inset-0 grid place-items-center" role="status" aria-label={t('line3d.loading')}>
                  <Skeleton w={220} h={20} />
                </div>
              )}
              <canvas
                ref={canvasRef}
                className={`h-full w-full cursor-grab ${mode === '3d' ? '' : 'invisible'}`}
                aria-label={t('line3d.canvasLabel')}
                onClick={pick}
              />
              {mode !== '3d' && plans[mode] && (
                <PlanView kind={mode} img={plans[mode]!} view={sceneView} parts={src.parts} sel={sel} onSelect={setSel} />
              )}
              {mode === '3d' && (
                <p className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-ink-46">{t('line3d.selectHint')}</p>
              )}
            </>
          )}
        </div>
        <div className="w-[340px] shrink-0 overflow-auto">
        <Card title={part ? part.label : t('faceplate.title')}>
          {/* canvas picking is pointer-only — this list is the keyboard path to
              the same selection (and the cage highlight) */}
          <input type="search" className="input mb-2 w-full text-[12px]" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={t('plant.search')} aria-label={t('plant.search')} />
          <ul className="mb-3 flex max-h-56 flex-wrap gap-1 overflow-auto" aria-label={t('palette.equipment')}>
            {src.parts.map((p, i) => ({ p, i })).filter(({ p }) => !q || `${p.label} ${src.kinds[p.kind]?.label ?? p.kind}`.toLowerCase().includes(q.toLowerCase())).map(({ p, i }) => (
              <li key={`${p.label}-${i}`}>
                <button
                  type="button"
                  aria-pressed={sel === String(i)}
                  onClick={() => setSel(sel === String(i) ? null : String(i))}
                  className={`h-6 rounded border px-2 text-[11px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue ${
                    sel === String(i) ? 'border-blue bg-info-soft text-blue' : 'border-line text-ink-68 hover:bg-subtle'
                  }`}
                >
                  {p.label}
                </button>
              </li>
            ))}
          </ul>
          {part ? <PartPanel part={part} kind={src.kinds[part.kind]} /> : <p className="text-[12px] text-ink-46">{t('line.selectHint')}</p>}
        </Card>
        </div>
      </div>
    </>
  );
}
