// Per-camera material decision settings: thresholds, picture conditioning,
// PLC output. Every value has a range from the server (single source) and a
// plain-words hint; nothing here needs a code change to adapt to a new site.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../lib/api';
import { plantApi } from '../../lib/plantModel';
import { Notice, SkeletonRows } from '../../shared/ui/Feedback';
import { camApi, type Camera } from '../cameras/api';
import { matApi, type MatSettings } from './api';
import './i18n';

type Ranges = Record<string, { min: number | null; max: number | null }>;

function Slider({ id, label, hint, value, range, step, unit, onChange, disabled }: {
  id: string; label: string; hint?: string; value: number; range?: { min: number | null; max: number | null };
  step: number; unit?: string; onChange: (v: number) => void; disabled?: boolean;
}) {
  const min = range?.min ?? 0, max = range?.max ?? 100;
  return (
    <div>
      <label className="field-label flex justify-between" htmlFor={id}>
        <span>{label}</span><span className="font-mono text-ink-68">{value}{unit ?? ''}</span>
      </label>
      <input id={id} type="range" className="w-full" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <p className="text-[11px] text-ink-46">{hint}</p>}
    </div>
  );
}

export function MaterialPanel({ orgId, cam, admin, onClose }: { orgId: string; cam: Camera; admin: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const schema = useQuery({ queryKey: ['mat-schema'], queryFn: matApi.schema, staleTime: Infinity });
  const tags = useQuery({ queryKey: ['mat-tags'], queryFn: plantApi.tags, staleTime: 60_000 });
  const snap = useQuery({
    queryKey: ['mat-snap', cam.id], queryFn: () => camApi.snapshot(orgId, cam.id).then((b) => URL.createObjectURL(b)),
    refetchInterval: 8_000, retry: false,
  });
  const [s, setS] = useState<MatSettings | null>(null);
  const [msg, setMsg] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (schema.data && !s) setS(cam.material ?? { ...schema.data.defaults, enabled: false }); }, [schema.data, cam.material, s]);
  useEffect(() => () => { if (snap.data) URL.revokeObjectURL(snap.data); }, [snap.data]);

  const save = useMutation({
    mutationFn: (v: MatSettings) => matApi.save(orgId, cam.edge_id, cam.id, v),
    onSuccess: () => { setSaved(true); setMsg(''); void qc.invalidateQueries({ queryKey: ['mat-cams'] }); void qc.invalidateQueries({ queryKey: ['cameras'] }); },
    onError: (e) => setMsg(t('mat.errSave', { why: e instanceof ApiError ? e.message : '?' })),
  });
  if (!s || !schema.data) return <section className="rounded-[5px] border border-line bg-white p-4"><SkeletonRows rows={4} /></section>;

  const R: Ranges = schema.data.ranges;
  const set = (p: Partial<MatSettings>) => { setS({ ...s, ...p }); setSaved(false); };
  const setPre = (p: Partial<MatSettings['preprocess']>) => set({ preprocess: { ...s.preprocess, ...p } });
  const setOut = (p: Partial<MatSettings['outputs']>) => set({ outputs: { ...s.outputs, ...p } });
  const ro = !admin;
  const writable = (tags.data ?? []).filter((x) => x.writable);
  const tagSelect = (key: 'code' | 'margin_pct' | 'uncertain' | 'trigger', label: string, type: 'number' | 'bool') => (
    <div key={key}>
      <label className="field-label" htmlFor={`mp-${key}`}>{label}</label>
      <select id={`mp-${key}`} className="input h-8 w-full" disabled={ro} value={s.outputs[key] ?? ''}
        onChange={(e) => setOut({ [key]: e.target.value || null })}>
        <option value="">{t('mat.tagNone')}</option>
        {writable.filter((x) => x.type === type).map((x) => <option key={x.path} value={x.path}>{x.path}</option>)}
      </select>
    </div>
  );
  const roi = s.preprocess.roi;
  const live = cam.material_live;

  return (
    <section className="rounded-[5px] border border-line bg-white p-4" aria-label={`${t('mat.title')} — ${cam.name}`}>
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">{t('mat.title')} — {cam.name}</h2>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>{t('cam.close')}</button>
      </div>
      <p className="mb-3 text-[12px] text-ink-68">{t('mat.lede')}</p>
      {msg && <div className="mb-3"><Notice tone="error">{msg}</Notice></div>}
      {live && (
        <p className="mb-3 text-[12px] text-ink-68">
          {t('mat.live')}: {live.gate === 'present' ? t('mat.gatePresent') : t('mat.gateEmpty')}
          {live.last ? ` · ${t('mat.lastTruck')}: ${t(`mat.${live.last.decision === 'no-material' ? 'none' : live.last.decision}`)}` : ''}
        </p>
      )}
      <label className="mb-4 flex items-center gap-2 text-[13px] font-medium">
        <input type="checkbox" checked={s.enabled} disabled={ro} onChange={(e) => set({ enabled: e.target.checked })} /> {t('mat.enabled')}
      </label>

      <div className="grid gap-6 lg:grid-cols-3">
        <fieldset className="space-y-3" disabled={ro}>
          <legend className="mb-2 text-[13px] font-semibold">{t('mat.secDecision')}</legend>
          <Slider id="mp-conf" label={t('mat.conf')} hint={t('mat.confHint')} value={s.conf} range={R.conf} step={0.05} onChange={(v) => set({ conf: v })} />
          <Slider id="mp-area" label={t('mat.areaMin')} hint={t('mat.areaMinHint')} value={s.area_min} range={R.area_min} step={0.001} onChange={(v) => set({ area_min: v })} />
          <Slider id="mp-cov" label={t('mat.coverageGate')} hint={t('mat.coverageGateHint')} value={s.coverage_gate} range={R.coverage_gate} step={0.005} onChange={(v) => set({ coverage_gate: v })} />
          <Slider id="mp-ke" label={t('mat.kEnter')} hint={t('mat.kEnterHint')} value={s.k_enter} range={R.k_enter} step={1} onChange={(v) => set({ k_enter: v })} />
          <Slider id="mp-kl" label={t('mat.kLeave')} hint={t('mat.kLeaveHint')} value={s.k_leave} range={R.k_leave} step={1} onChange={(v) => set({ k_leave: v })} />
          <Slider id="mp-mf" label={t('mat.minFrames')} hint={t('mat.minFramesHint')} value={s.min_frames} range={R.min_frames} step={1} onChange={(v) => set({ min_frames: v })} />
          <Slider id="mp-mm" label={t('mat.minMargin')} hint={t('mat.minMarginHint')} value={s.min_margin} range={R.min_margin} step={0.05} onChange={(v) => set({ min_margin: v })} />
          <Slider id="mp-me" label={t('mat.maxEvent')} hint={t('mat.maxEventHint')} value={s.max_event_s} range={R.max_event_s} step={10} onChange={(v) => set({ max_event_s: v })} />
          <div>
            <label className="field-label" htmlFor="mp-rule">{t('mat.rule')}</label>
            <select id="mp-rule" className="input h-8 w-full" value={s.rule} onChange={(e) => set({ rule: e.target.value as MatSettings['rule'] })}>
              <option value="mass_vote">{t('mat.ruleMass')}</option>
              <option value="frame_majority">{t('mat.ruleFrames')}</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="field-label" htmlFor="mp-gc">{t('mat.gravelClass')}</label>
              <input id="mp-gc" className="input h-8 w-full" value={s.gravel_class} onChange={(e) => set({ gravel_class: e.target.value })} /></div>
            <div><label className="field-label" htmlFor="mp-sc">{t('mat.sandClass')}</label>
              <input id="mp-sc" className="input h-8 w-full" value={s.sand_class} onChange={(e) => set({ sand_class: e.target.value })} /></div>
          </div>
        </fieldset>

        <fieldset className="space-y-3" disabled={ro}>
          <legend className="mb-2 text-[13px] font-semibold">{t('mat.secPre')}</legend>
          <div className="relative overflow-hidden rounded border border-line bg-ink/90">
            {snap.data ? <img src={snap.data} alt={cam.name} className="block w-full" /> : <div className="aspect-video" />}
            {roi && <div className="pointer-events-none absolute border-2 border-dashed border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
              style={{ left: `${roi[0] * 100}%`, top: `${roi[1] * 100}%`, width: `${(roi[2] - roi[0]) * 100}%`, height: `${(roi[3] - roi[1]) * 100}%` }} />}
          </div>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={s.preprocess.clahe} onChange={(e) => setPre({ clahe: e.target.checked })} /> {t('mat.clahe')}</label>
          {s.preprocess.clahe && <Slider id="mp-cc" label={t('mat.claheClip')} value={s.preprocess.clahe_clip} range={R['preprocess.clahe_clip']} step={0.5} onChange={(v) => setPre({ clahe_clip: v })} />}
          <Slider id="mp-ga" label={t('mat.gamma')} value={s.preprocess.gamma} range={R['preprocess.gamma']} step={0.05} onChange={(v) => setPre({ gamma: v })} />
          <Slider id="mp-br" label={t('mat.brightness')} value={s.preprocess.brightness} range={R['preprocess.brightness']} step={5} onChange={(v) => setPre({ brightness: v })} />
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={!!roi} onChange={(e) => setPre({ roi: e.target.checked ? [0.1, 0.1, 0.9, 0.9] : null })} /> {t('mat.roi')}: {roi ? t('mat.roiOn') : t('mat.roiOff')}
          </label>
          {roi && (
            <div className="grid grid-cols-4 gap-1">
              {['L', 'T', 'R', 'B'].map((n, i) => (
                <input key={n} type="number" step={0.05} min={0} max={1} className="input h-8" aria-label={n} value={roi[i]}
                  onChange={(e) => { const r = [...roi]; r[i] = Math.min(1, Math.max(0, Number(e.target.value))); setPre({ roi: r }); }} />
              ))}
            </div>
          )}
          <p className="text-[11px] text-ink-46">{roi ? t('mat.roiHint') : t('mat.preNote')}</p>
        </fieldset>

        <fieldset className="space-y-3" disabled={ro}>
          <legend className="mb-2 text-[13px] font-semibold">{t('mat.secPlc')}</legend>
          <label className="flex items-start gap-2 text-[13px]">
            <input type="checkbox" className="mt-1" checked={s.dry_run} onChange={(e) => set({ dry_run: e.target.checked })} /> {t('mat.dryRunLabel')}
          </label>
          {!s.dry_run && <Notice tone="warn">{t('mat.dryRunOff')}</Notice>}
          {tagSelect('code', t('mat.tagCode'), 'number')}
          <div className="grid grid-cols-3 gap-2">
            {([['gravel_value', 'vGravel'], ['sand_value', 'vSand'], ['none_value', 'vNone']] as const).map(([k, l]) => (
              <div key={k}><label className="field-label" htmlFor={`mp-${k}`}>{t(`mat.${l}`)}</label>
                <input id={`mp-${k}`} type="number" min={0} max={65535} className="input h-8 w-full" value={s.outputs[k]} onChange={(e) => setOut({ [k]: Number(e.target.value) })} /></div>
            ))}
          </div>
          {tagSelect('margin_pct', t('mat.tagMargin'), 'number')}
          {tagSelect('uncertain', t('mat.tagUncertain'), 'bool')}
          {tagSelect('trigger', t('mat.tagTrigger'), 'bool')}
          <Slider id="mp-pl" label={t('mat.pulse')} value={s.outputs.pulse_ms} step={50} range={{ min: 50, max: 10000 }} onChange={(v) => setOut({ pulse_ms: v })} />
          <p className="text-[11px] text-ink-46">{t('mat.plcHint')}</p>
        </fieldset>
      </div>

      {admin && (
        <div className="mt-4 flex items-center gap-2">
          <button type="button" className="btn btn-sm" disabled={save.isPending} onClick={() => save.mutate(s)}>{t('mat.save')}</button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setS({ ...schema.data.defaults, outputs: s.outputs, enabled: s.enabled }); setSaved(false); }}>{t('mat.reset')}</button>
          {saved && <span className="text-[12px] text-ink-68" role="status">{t('mat.saved')}</span>}
        </div>
      )}
    </section>
  );
}
