// 3D line twin — lazy three.js scene bound to the live store. buildScene
// returns a view handle; applyState shades equipment on each store flush.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { live, STALE_MS } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { EQUIPMENT, formatSignal, unitOf, type EquipmentId } from '../../lib/plant';
import { QualityMark } from '../../shared/ui/Status';
import { PageBar, Card } from '../../shared/ui/Page';
import { ErrorState, Skeleton } from '../../shared/ui/Feedback';
import { Icon } from '../../shared/ui/Icon';
import type { LineSceneView } from './scene';

export function Line3DPage() {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<LineSceneView | null>(null);
  const [sel, setSel] = useState<EquipmentId | null>(null);
  const [ready, setReady] = useState(false);
  const [fail, setFail] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const ver = useStore(() => live.version);

  useEffect(() => {
    let dead = false;
    let view: LineSceneView | null = null;
    let raf = 0;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    void import('./scene').then(({ buildScene, applyState }) => {
      if (dead || !canvasRef.current) return;
      return buildScene(canvasRef.current).then((v) => {
        if (dead) { v.dispose(); return; }
        view = v;
        viewRef.current = v;
        const host = canvasRef.current!.parentElement!;
        const size = () => view?.setSize(host.clientWidth, host.clientHeight);
        size();
        const ro = new ResizeObserver(size);
        ro.observe(host);
        const loop = (tPrev: number) => {
          let last = tPrev;
          raf = requestAnimationFrame(function tick(now) {
            const dt = now - last;
            last = now;
            if (view?.tick(dt)) return void (raf = requestAnimationFrame(tick));
            // idle — still keep the loop so motion resumes on state change
            raf = requestAnimationFrame(tick);
          });
        };
        raf = requestAnimationFrame(loop);
        setReady(true);
        applyState(v, live, { reduceMotion: reduced });
        // keep applyState reachable on each store flush
        (viewRef as { _apply?: typeof applyState })._apply = applyState;
        return () => ro.disconnect();
      });
    }).catch(() => { if (!dead) setFail(true); });
    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      view?.dispose();
      viewRef.current = null;
    };
  }, [attempt]);

  // shade the scene on every live flush
  useEffect(() => {
    const v = viewRef.current;
    const apply = (viewRef as { _apply?: (v: LineSceneView, s: typeof live, o?: object) => void })._apply;
    if (v && apply) apply(v, live, { selected: sel, reduceMotion: matchMedia('(prefers-reduced-motion: reduce)').matches });
  }, [ver, sel]);

  const pick = (e: React.MouseEvent) => {
    const v = viewRef.current;
    if (!v) return;
    // pick() expects CLIENT coordinates — it resolves the canvas rect itself
    setSel(v.pick(e.clientX, e.clientY));
  };

  const eq = sel && EQUIPMENT.find((e) => e.id === sel);

  return (
    <>
      <PageBar
        title={t('line3d.title')}
        lede={t('line3d.lede')}
        actions={
          <button className="btn btn-sm btn-ghost" onClick={() => viewRef.current?.resetView()}>
            <Icon name="refresh" size={13} /> {t('line3d.resetView')}
          </button>
        }
      />
      <div className="flex h-[calc(100svh-88px)] gap-3 p-4">
        <div className="relative h-full min-w-0 flex-1 overflow-hidden rounded-[5px] border border-line bg-white shadow-card">
          {fail ? (
            <ErrorState onRetry={() => { setFail(false); setReady(false); setAttempt((n) => n + 1); }} />
          ) : (
            <>
              {!ready && (
                <div className="absolute inset-0 grid place-items-center" role="status" aria-label={t('line3d.loading')}>
                  <Skeleton w={220} h={20} />
                </div>
              )}
              <canvas
                ref={canvasRef}
                className="h-full w-full cursor-grab"
                aria-label={t('line3d.canvasLabel')}
                onClick={pick}
              />
              <p className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-ink-46">{t('line3d.selectHint')}</p>
            </>
          )}
        </div>
        <Card title={eq ? t(eq.labelKey) : t('faceplate.title')}>
          {/* canvas picking is pointer-only — this group is the keyboard
              path to the same selection (and the cage highlight) */}
          <div className="mb-3 flex flex-wrap gap-1" role="group" aria-label={t('palette.equipment')}>
            {EQUIPMENT.map((e) => (
              <button
                key={e.id}
                type="button"
                aria-pressed={sel === e.id}
                onClick={() => setSel(sel === e.id ? null : e.id)}
                className={`h-6 rounded border px-2 text-[11px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue ${
                  sel === e.id
                    ? 'border-blue bg-info-soft text-blue'
                    : 'border-line text-ink-68 hover:bg-subtle'
                }`}
              >
                {t(e.labelKey)}
              </button>
            ))}
          </div>
          {eq ? (
            <ul className="flex flex-col gap-1.5">
              {eq.signals.map((tag) => {
                const tv = live.latest.get(tag);
                const stale = !tv || now - Date.parse(tv.ts) > STALE_MS;
                return (
                  <li key={tag} className="flex justify-between gap-2 text-[12px]">
                    <span className="font-mono text-ink-68">{tag.split('.').slice(-1)[0]}</span>
                    <span className="flex items-center gap-1.5 font-mono font-semibold">
                      {tv && !stale ? formatSignal(tag, tv.v, i18n.language) : '—'}
                      {unitOf(tag) && <span className="font-sans text-[10px] font-normal text-ink-46">{unitOf(tag)}</span>}
                      <QualityMark q={tv?.q} stale={stale} />
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-[12px] text-ink-46">{t('line.selectHint')}</p>
          )}
        </Card>
      </div>
    </>
  );
}
