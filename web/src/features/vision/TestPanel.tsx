// Inline "test this version on a gateway" panel expanded under a version row
// (plan M1-05 T5). One image -> one edge -> sanitized detections drawn on a
// canvas. Nothing runs without the admin pressing Run test; a stale response,
// snapshot or image decode can never attach to a newer image/gateway.

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { ApiError, adminApi, type Device } from '../../lib/api';
import { useAdminSite } from '../admin/admin';
import { camApi } from '../cameras/api';
import { ErrorState, Notice, SkeletonRows } from '../../shared/ui/Feedback';
import { visionApi, type ModelTestResult, type ModelVersion, type VisionModel } from './api';
import { bboxRect, polygonPoints, visibleDetections } from './overlay';
import './i18n';

const EDGE_STALE_AFTER_S = 15;            // mirror of backend config.EDGE_STALE_AFTER_S
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png'];

const online = (e: Device) =>
  e.status === 'active' && !!e.last_hb_at &&
  (Date.now() - Date.parse(e.last_hb_at)) / 1000 <= EDGE_STALE_AFTER_S;

const testable = (v: ModelVersion) =>
  ['draft', 'active'].includes(v.status) && (v.classes?.length ?? 0) > 0;

export function TestPanel({ orgId, model, version, admin, onClose }: {
  orgId: string; model: VisionModel; version: ModelVersion; admin: boolean; onClose: () => void;
}) {
  const { t } = useTranslation();
  const uid = useId();
  const { site } = useAdminSite(orgId);
  const edges = useQuery({
    queryKey: ['devices', orgId, site?.id], queryFn: () => adminApi.devices(orgId!, site!.id),
    enabled: !!site, refetchInterval: 10_000,
  });
  const gateways = (edges.data?.items ?? []).filter(online);

  const [edgePick, setEdgePick] = useState('');
  const [camPick, setCamPick] = useState('');
  const edgeId = gateways.some((g) => g.id === edgePick) ? edgePick : gateways[0]?.id ?? '';
  const cams = useQuery({
    queryKey: ['cameras', orgId, edgeId], queryFn: () => camApi.cameras(orgId, edgeId),
    enabled: !!edgeId, refetchInterval: 10_000,
  });
  const camSel = cams.data?.items.some((c) => c.id === camPick)
    ? camPick : cams.data?.items[0]?.id ?? '';

  const [blob, setBlob] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [ready, setReady] = useState(false);                // current blob decoded OK — gates Run
  const [result, setResult] = useState<ModelTestResult | null>(null);
  const [ran, setRan] = useState(false);                  // distinguishes "not run" from "0 detections"
  const [conf, setConf] = useState(0.25);
  const [err, setErr] = useState('');
  const [pending, setPending] = useState(false);
  const [snapBusy, setSnapBusy] = useState(false);
  const seq = useRef(0);                                  // inference request sequence
  const abort = useRef<AbortController | null>(null);
  const snapSeq = useRef(0);                              // snapshot request sequence
  const snapAbort = useRef<AbortController | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);   // decoded image, keyed by preview
  const drawRef = useRef<() => void>(() => {});

  // repaint the cached image + the filtered overlay — synchronous, no re-decode
  drawRef.current = () => {
    const canvas = canvasRef.current, img = imgRef.current;
    if (!canvas || !img) return;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const cs = getComputedStyle(canvas);
    const accent = cs.getPropertyValue('--color-blue').trim() || '#006bc2';
    ctx.drawImage(img, 0, 0);
    if (!result) return;
    const w = img.naturalWidth, h = img.naturalHeight;
    ctx.strokeStyle = ctx.fillStyle = accent;
    ctx.lineWidth = Math.max(2, Math.round(w / 480));
    ctx.font = `${Math.max(12, Math.round(w / 60))}px ${cs.fontFamily || 'sans-serif'}`;
    for (const d of visibleDetections(result.detections, conf)) {
      const r = bboxRect(d.bbox, w, h);
      if (d.polygon && d.polygon.length >= 3) {
        const pts = polygonPoints(d.polygon, w, h);
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        pts.slice(1).forEach(([x, y]) => ctx.lineTo(x, y));
        ctx.closePath();
        ctx.stroke();
      } else {
        ctx.strokeRect(r.x, r.y, r.width, r.height);
      }
      const ty = r.y > 18 ? r.y - 6 : r.y + r.height + 16;
      ctx.fillText(`${d.class} ${(d.score * 100).toFixed(0)}%`, r.x + 2, ty);
    }
  };

  // object URL lifecycle: created per blob, revoked on replace/unmount
  useEffect(() => {
    if (!blob) { setPreview(null); return; }
    const url = URL.createObjectURL(blob);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  // decode exactly the submitted bytes; a stale onload can never overwrite a
  // newer image because cleanup sets `disposed` first
  useEffect(() => {
    const canvas = canvasRef.current;
    imgRef.current = null;                     // old decode must never repaint the new image
    setReady(false);
    if (!preview) {
      if (canvas) { canvas.width = 0; canvas.height = 0; }
      return;
    }
    let disposed = false;
    const img = new Image();
    img.onload = () => {
      if (disposed || img.src !== preview) return;
      imgRef.current = img;
      setReady(true);
      drawRef.current();
    };
    img.onerror = () => {
      if (disposed) return;
      imgRef.current = null;
      if (canvas) { canvas.width = 0; canvas.height = 0; }
      setReady(false);
      setErr(t('vis.testInvalidImage'));
    };
    img.src = preview;
    return () => { disposed = true; };
  }, [preview, t]);

  // slider/result/preview change -> repaint only (the image is already decoded)
  useEffect(() => { drawRef.current(); }, [conf, result, preview]);

  const cancelWork = () => {
    seq.current += 1;
    abort.current?.abort();
    snapSeq.current += 1;
    snapAbort.current?.abort();
    setPending(false);
    setSnapBusy(false);
  };

  const setImage = (b: Blob | null) => {
    cancelWork();
    setResult(null); setRan(false); setErr('');
    setBlob(b);
  };

  // identity change (gateway/version) cancels everything in flight
  useEffect(() => {
    seq.current += 1;
    abort.current?.abort();
    snapSeq.current += 1;
    snapAbort.current?.abort();
    setPending(false); setSnapBusy(false);
    setResult(null); setRan(false); setErr('');
  }, [edgeId, version.id]);
  useEffect(() => () => { abort.current?.abort(); snapAbort.current?.abort(); }, []);

  // camera change (pick or derived fallback) cancels an in-flight snapshot so a
  // frame from the previous camera can never overwrite the new choice
  useEffect(() => {
    snapSeq.current += 1;
    snapAbort.current?.abort();
    setSnapBusy(false);
    setResult(null); setRan(false); setErr('');
  }, [camSel]);
  const pickCam = (id: string) => {
    snapSeq.current += 1;
    snapAbort.current?.abort();
    setSnapBusy(false);
    setCamPick(id);
  };

  const pickFile = (f: File | undefined | null) => {
    if (!f) return;
    if (!IMAGE_TYPES.includes(f.type) || f.size <= 0 || f.size > MAX_IMAGE_BYTES) {
      // invalid pick cancels pending work/results; prior image stays untouched
      cancelWork();
      setResult(null); setRan(false);
      setErr(t('vis.testInvalidFile'));
      return;
    }
    setImage(f);
  };

  const fail = (e: unknown): string => {
    if (!(e instanceof ApiError)) return t('dev.errNetwork');
    if (e.status === 409) return t('vis.testOffline');
    if (e.status === 413) return t('vis.errTooLarge');
    if (e.status === 422) return t('vis.testInvalidImage');
    if (e.status === 504) return t('vis.testTimeout');
    return t('vis.errGeneric', { reason: e.message });
  };

  const run = async () => {
    if (!blob || !edgeId || pending || snapBusy) return;
    const my = ++seq.current;
    const ac = new AbortController();
    abort.current = ac;
    setPending(true); setErr(''); setResult(null); setRan(false);
    const submitted = blob;                    // preview above shows exactly these bytes
    try {
      const r = await visionApi.test(orgId, model.id, version.id, edgeId, submitted, ac.signal);
      if (seq.current === my) { setResult(r); setRan(true); }
    } catch (e) {
      if (seq.current === my && !ac.signal.aborted) { setErr(fail(e)); setResult(null); setRan(false); }
    } finally {
      if (seq.current === my) setPending(false);
    }
  };

  const useFrame = async () => {
    if (!camSel || snapBusy) return;
    // a snapshot replaces whatever an in-flight inference/preview was doing
    seq.current += 1;
    abort.current?.abort();
    setPending(false); setResult(null); setRan(false); setErr('');
    const my = ++snapSeq.current;
    const ac = new AbortController();
    snapAbort.current = ac;
    setSnapBusy(true);
    try {
      const b = await camApi.snapshot(orgId, camSel, ac.signal);
      if (snapSeq.current !== my || ac.signal.aborted) return;   // superseded
      if (b.size > 0 && b.size <= MAX_IMAGE_BYTES) setBlob(b);
      else setErr(t('vis.testNoSnapshot'));
    } catch (e) {
      if (snapSeq.current === my && !ac.signal.aborted) setErr(t('vis.testNoSnapshot'));
    } finally {
      if (snapSeq.current === my) setSnapBusy(false);
    }
  };

  const dets = result ? visibleDetections(result.detections, conf) : [];

  // hide entirely if the role/version lost eligibility since the row opened
  if (!admin || !testable(version)) return null;

  return (
    <div className="space-y-3" role="group" aria-label={t('vis.testTitle', { name: model.name, v: version.version })}>
      <div className="flex items-center justify-between">
        <h4 className="text-[14px] font-semibold">{t('vis.testTitle', { name: model.name, v: version.version })}</h4>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>{t('vis.close')}</button>
      </div>
      {err && <Notice tone="error">{err}</Notice>}
      {edges.isError ? <ErrorState compact onRetry={() => void edges.refetch()} />
        : edges.isLoading || !site ? <SkeletonRows rows={2} />
        : gateways.length === 0 ? (
          <Notice tone="info">{t('vis.testNoGateways')}</Notice>
        ) : (
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <div className="min-w-0 space-y-3">
              <div>
                <label className="field-label" htmlFor={`${uid}-gw`}>{t('vis.testGateway')}</label>
                <select id={`${uid}-gw`} className="input h-8 w-full" value={edgeId} onChange={(e) => setEdgePick(e.target.value)}>
                  {gateways.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
              {cams.isError ? <Notice tone="error">{t('vis.errGeneric', { reason: 'cameras' })}</Notice>
                : (cams.data?.items.length ?? 0) > 0 && (
                <div className="min-w-0">
                  <label className="field-label" htmlFor={`${uid}-cam`}>{t('vis.testPickCamera')}</label>
                  <div className="flex flex-wrap items-end gap-2">
                    <select id={`${uid}-cam`} className="input h-8 min-w-0 flex-1" value={camSel}
                      onChange={(e) => pickCam(e.target.value)}>
                      {cams.data!.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <button type="button" className="btn btn-sm btn-ghost" disabled={snapBusy} onClick={() => void useFrame()}>
                      {snapBusy ? t('vis.testRunning') : t('vis.testUseFrame')}
                    </button>
                  </div>
                </div>
              )}
              <div
                className="rounded-[5px] border border-dashed border-line px-3 py-4 text-center text-[13px] text-ink-68"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); pickFile(e.dataTransfer.files?.[0]); }}
              >
                <p>{t('vis.testDrop')}</p>
                <p className="mt-1 text-[12px] text-ink-46">{t('vis.testLimits')}</p>
                <label className="btn btn-sm mt-2 inline-block cursor-pointer">
                  {t('vis.testChoose')}
                  <input type="file" accept="image/jpeg,image/png" className="sr-only"
                    onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }} />
                </label>
              </div>
              <div>
                <label className="field-label" htmlFor={`${uid}-conf`}>{t('vis.testConf')}: {conf.toFixed(2)}</label>
                <input id={`${uid}-conf`} type="range" min={0.05} max={1} step={0.01} value={conf}
                  className="w-full" onChange={(e) => setConf(Number(e.target.value))} />
              </div>
              <button type="button" className="btn btn-sm" disabled={!blob || !ready || !edgeId || pending || snapBusy}
                onClick={() => void run()} aria-busy={pending || undefined}>
                {pending ? t('vis.testRunning') : t('vis.testRun')}
              </button>
            </div>
            <div className="min-w-0">
              {preview ? (
                <canvas ref={canvasRef} className="block w-full max-w-full rounded-[5px] border border-line"
                  aria-label={t('vis.testTitle', { name: model.name, v: version.version })} />
              ) : (
                <p className="rounded-[5px] border border-line px-3 py-6 text-center text-[13px] text-ink-46" role="status">
                  {t('vis.testNoImage')}
                </p>
              )}
              <div role="status" aria-live="polite" className="mt-2">
                {ran && result && (
                  <p className="text-[12px] text-ink-68">
                    {t('vis.testLatency', { ms: Math.round(result.ms) })}
                    {result.engine ? ` · ${t('vis.testEngine', { engine: result.engine })}` : ''}
                  </p>
                )}
                {ran && result && (
                  dets.length === 0 ? (
                    <p className="text-[13px] text-ink-68">{t('vis.testNone')}</p>
                  ) : (
                    <ul className="mt-1 space-y-0.5 text-[13px]">
                      {dets.map((d, i) => (
                        <li key={i}>{d.class} <span className="text-ink-46">{(d.score * 100).toFixed(0)}%</span></li>
                      ))}
                    </ul>
                  )
                )}
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
