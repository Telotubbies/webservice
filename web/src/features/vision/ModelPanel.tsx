// Per-camera model pin and class settings (roadmap 9.3, 9.4).

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../lib/api';
import { Notice, SkeletonRows } from '../../shared/ui/Feedback';
import type { Camera } from '../cameras/api';
import { visionApi, type ModelVersion } from './api';
import { classRows, diffSummary, patchClass, scoreOk, type ClassConfig, type ClassDiff } from './logic';
import './i18n';

export function ModelPanel({ orgId, cam, admin, onClose }: { orgId: string; cam: Camera; admin: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const pinKey = ['vis-pin', orgId, cam.id];
  const pin = useQuery({ queryKey: pinKey, queryFn: () => visionApi.pin(orgId, cam.id) });
  const models = useQuery({ queryKey: ['vis-models', orgId], queryFn: () => visionApi.models(orgId) });
  const active = useQuery({
    queryKey: ['vis-active', orgId, models.data?.items.map((m) => m.id).join(',')],
    enabled: !!models.data,
    queryFn: async () => {
      const out: { model: string; v: ModelVersion }[] = [];
      for (const m of models.data!.items) {
        const vs = await visionApi.versions(orgId, m.id);
        vs.items.filter((v) => v.status === 'active').forEach((v) => out.push({ model: m.name, v }));
      }
      return out;
    },
  });
  const presets = useQuery({
    queryKey: ['vis-presets', orgId, pin.data?.model_id], enabled: !!pin.data?.model_id,
    queryFn: () => visionApi.presets(orgId, pin.data!.model_id!),
  });
  const [versionId, setVersionId] = useState('');
  const [placement, setPlacement] = useState<'auto' | 'edge' | 'cloud'>('auto');
  const [cfg, setCfg] = useState<ClassConfig>({});
  const [diff, setDiff] = useState<ClassDiff | null>(null);
  const [msg, setMsg] = useState('');
  const [saved, setSaved] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [presetId, setPresetId] = useState('');

  useEffect(() => {
    if (pin.data) { setVersionId(pin.data.model_version_id ?? ''); setPlacement(pin.data.placement ?? 'auto'); setCfg(pin.data.class_config ?? {}); }
  }, [pin.data]);

  const fail = (e: unknown) => setMsg(e instanceof ApiError ? t('vis.errGeneric', { reason: e.message }) : t('dev.errNetwork'));
  const reload = () => void qc.invalidateQueries({ queryKey: pinKey });
  const doPin = useMutation({
    mutationFn: () => visionApi.setPin(orgId, cam.id, { model_version_id: versionId, placement }),
    onSuccess: (r) => { setDiff(r.diff); setMsg(''); reload(); }, onError: fail,
  });
  const unpin = useMutation({ mutationFn: () => visionApi.unpin(orgId, cam.id), onSuccess: () => { setDiff(null); reload(); }, onError: fail });
  const save = useMutation({
    mutationFn: () => visionApi.patchClasses(orgId, cam.id, cfg),
    onSuccess: () => { setSaved(true); setMsg(''); reload(); }, onError: fail,
  });
  const savePreset = useMutation({
    mutationFn: () => visionApi.createPreset(orgId, pin.data!.model_id!, presetName.trim(), cfg),
    onSuccess: () => { setPresetName(''); void qc.invalidateQueries({ queryKey: ['vis-presets', orgId, pin.data?.model_id] }); }, onError: fail,
  });
  const apply = useMutation({
    mutationFn: () => visionApi.applyPreset(orgId, cam.id, presetId),
    onSuccess: (r) => { setCfg(r.class_config); reload(); }, onError: fail,
  });

  const pinned = !!pin.data?.model_version_id;
  const rows = pinned ? classRows(pin.data!.classes ?? [], cfg) : [];
  const scoreBad = rows.some((r) => !scoreOk(r.min_score));
  const sum = diffSummary(diff);
  const edit = (id: string, p: Parameters<typeof patchClass>[2]) => { setSaved(false); setCfg((c) => patchClass(c, id, p)); };

  return (
    <section className="rounded-[5px] border border-line bg-white p-4" aria-label={`${t('vis.panelTitle')} — ${cam.name}`}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">{t('vis.panelTitle')} — {cam.name}</h2>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>{t('vis.close')}</button>
      </div>
      {msg && <div className="mb-3"><Notice tone="error">{msg}</Notice></div>}
      {pin.isLoading || models.isLoading || active.isLoading ? <SkeletonRows rows={3} /> : (
        <>
          {!pinned && <p className="mb-2 text-[13px] text-ink-68">{t('vis.noModelPinned')}</p>}
          {(active.data ?? []).length === 0 && !pinned ? <Notice tone="info">{t('vis.noActive')}</Notice> : (
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="field-label" htmlFor="vp-version">{t('vis.pickVersion')}</label>
                <select id="vp-version" className="input h-8" value={versionId} disabled={!admin} onChange={(e) => setVersionId(e.target.value)}>
                  <option value="">{t('vis.none')}</option>
                  {(active.data ?? []).map(({ model, v }) => <option key={v.id} value={v.id}>{model} v{v.version}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="vp-place">{t('vis.placement')}</label>
                <select id="vp-place" className="input h-8" value={placement} disabled={!admin} onChange={(e) => setPlacement(e.target.value as typeof placement)}>
                  {(['auto', 'edge', 'cloud'] as const).map((p) => <option key={p} value={p}>{t(`vis.place_${p}`)}</option>)}
                </select>
              </div>
              {admin && <button type="button" className="btn btn-sm" disabled={!versionId || doPin.isPending} onClick={() => doPin.mutate()}>{t('vis.pin')}</button>}
              {admin && pinned && <button type="button" className="btn btn-sm btn-ghost" onClick={() => unpin.mutate()}>{t('vis.unpin')}</button>}
            </div>
          )}
          {sum && <div className="mt-3"><Notice tone="warn">{t('vis.diffNote', sum)}</Notice></div>}
          {pinned && (
            <>
              <h3 className="mt-4 text-[13px] font-semibold">{t('vis.classTable')}</h3>
              <div className="mt-1 overflow-x-auto">
                <table className="w-full border-collapse text-[13px]">
                  <thead><tr className="border-b border-line text-left">
                    {['colOn', 'colName', 'colNameTh', 'colScore', 'colColour', 'colAlert'].map((c) => <th key={c} scope="col" className="h-8 px-2 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-68">{t(`vis.${c}`)}</th>)}
                  </tr></thead>
                  <tbody>{rows.map((r) => (
                    <tr key={r.id} className="border-b border-line last:border-0">
                      <td className="px-2 py-1"><input type="checkbox" aria-label={`${r.name} ${t('vis.colOn')}`} checked={r.enabled} disabled={!admin} onChange={(e) => edit(r.id, { enabled: e.target.checked })} /></td>
                      <td className="px-2 py-1"><input className="input h-7 w-36" aria-label={`${r.name} ${t('vis.colName')}`} value={r.names.en} disabled={!admin} maxLength={80} onChange={(e) => edit(r.id, { names: { ...r.names, en: e.target.value } })} /></td>
                      <td className="px-2 py-1"><input className="input h-7 w-36" aria-label={`${r.name} ${t('vis.colNameTh')}`} value={r.names.th} disabled={!admin} maxLength={80} onChange={(e) => edit(r.id, { names: { ...r.names, th: e.target.value } })} /></td>
                      <td className="px-2 py-1"><input type="number" className="input h-7 w-20" aria-label={`${r.name} ${t('vis.colScore')}`} min={0.05} max={0.95} step={0.05} value={r.min_score} disabled={!admin} aria-invalid={!scoreOk(r.min_score) || undefined} onChange={(e) => edit(r.id, { min_score: Number(e.target.value) })} /></td>
                      <td className="px-2 py-1"><input type="color" aria-label={`${r.name} ${t('vis.colColour')}`} value={r.colour} disabled={!admin} onChange={(e) => edit(r.id, { colour: e.target.value })} /></td>
                      <td className="px-2 py-1"><input type="checkbox" aria-label={`${r.name} ${t('vis.colAlert')}`} checked={r.alert} disabled={!admin} onChange={(e) => edit(r.id, { alert: e.target.checked })} /></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              {scoreBad && <p className="mt-1 text-[12px] text-[var(--color-danger)]">{t('vis.errScore')}</p>}
              {admin && (
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <button type="button" className="btn btn-sm" disabled={scoreBad || save.isPending} onClick={() => save.mutate()}>{t('vis.saveClassSettings')}</button>
                  {saved && <span className="text-[12px] text-ink-68" role="status">{t('vis.saved')}</span>}
                </div>
              )}
              <h3 className="mt-4 text-[13px] font-semibold">{t('vis.presets')}</h3>
              <div className="mt-1 flex flex-wrap items-end gap-3">
                <select className="input h-8" aria-label={t('vis.pickPreset')} value={presetId} disabled={!admin} onChange={(e) => setPresetId(e.target.value)}>
                  <option value="">{t('vis.pickPreset')}</option>
                  {(presets.data?.items ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                {admin && <button type="button" className="btn btn-sm btn-ghost" disabled={!presetId} onClick={() => apply.mutate()}>{t('vis.applyPreset')}</button>}
                {admin && (
                  <>
                    <input className="input h-8" aria-label={t('vis.presetName')} placeholder={t('vis.presetName')} value={presetName} maxLength={120} onChange={(e) => setPresetName(e.target.value)} />
                    <button type="button" className="btn btn-sm btn-ghost" disabled={!presetName.trim() || savePreset.isPending} onClick={() => savePreset.mutate()}>{t('vis.savePreset')}</button>
                  </>
                )}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
