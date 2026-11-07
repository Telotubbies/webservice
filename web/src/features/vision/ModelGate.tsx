// Model gate (min accuracy and samples) and rollback, F12.
// Backend: backend/app/vision/quality.py (PUT .../gate, POST .../rollback).

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../../lib/api';
import { Confirm } from '../../shared/ui/Confirm';
import { Notice } from '../../shared/ui/Feedback';
import { visionApi } from './api';
import './i18n';

interface Quality { gate: { min_accuracy: number | null; min_samples: number | null; passed: boolean | null } }
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

export function ModelGate({ orgId, admin }: { orgId: string; admin: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [model, setModel] = useState('');
  const [version, setVersion] = useState('');
  const [acc, setAcc] = useState('');
  const [ns, setNs] = useState('');
  const [to, setTo] = useState('');
  const [ask, setAsk] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const models = useQuery({ queryKey: ['vis-models', orgId], queryFn: () => visionApi.models(orgId) });
  const versions = useQuery({ queryKey: ['vis-versions', orgId, model], enabled: !!model, queryFn: () => visionApi.versions(orgId, model) });
  const active = (versions.data?.items ?? []).filter((v) => v.status === 'active');
  const base = `/api/v1/orgs/${encodeURIComponent(orgId)}/vision/models/${model}`;
  const q = useQuery({ queryKey: ['vis-gate', orgId, model, version], enabled: !!model && !!version, queryFn: () => request<Quality>(`${base}/versions/${version}/quality`) });
  useEffect(() => { if (!model && models.data?.items[0]) setModel(models.data.items[0].id); }, [model, models.data]);
  useEffect(() => { setVersion(active[0]?.id ?? ''); setTo(''); }, [model, versions.data]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const g = q.data?.gate;
    setAcc(g?.min_accuracy != null ? String(Math.round(g.min_accuracy * 100)) : '');
    setNs(g?.min_samples != null ? String(g.min_samples) : '');
  }, [q.data]);

  const accN = Number(acc), nsN = Number(ns);
  const bad = acc !== '' && !(accN >= 0 && accN <= 100) ? 'acc' : ns !== '' && !(Number.isInteger(nsN) && nsN >= 1 && nsN <= 100000) ? 'ns' : '';
  const err = (e: unknown) => setMsg({ tone: 'error', text: t('vis.errGeneric', { reason: e instanceof Error ? e.message : String(e) }) });
  const save = useMutation({
    mutationFn: () => request(`${base}/gate`, json('PUT', { min_accuracy: acc === '' ? null : accN / 100, min_samples: ns === '' ? null : nsN })),
    onSuccess: () => { setMsg({ tone: 'ok', text: t('vis.gateSaved') }); void qc.invalidateQueries({ queryKey: ['vis-gate', orgId, model] }); }, onError: err,
  });
  const back = useMutation({
    mutationFn: () => request<{ cameras: number }>(`${base}/versions/${version}/rollback`, json('POST', { to_version: to })),
    onSuccess: (r) => { setAsk(false); setMsg({ tone: 'ok', text: t('vis.rolledBack', { count: r.cameras }) }); }, onError: (e) => { setAsk(false); err(e); },
  });
  const passed = q.data?.gate.passed;
  const verName = (id: string) => `v${versions.data?.items.find((v) => v.id === id)?.version ?? '?'}`;
  return (
    <section aria-label={t('vis.gateTitle')} className="space-y-2">
      <h2 className="text-[13px] font-medium">{t('vis.gateTitle')}</h2>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <div className="flex flex-wrap items-end gap-3 text-[13px]">
        <div><label className="field-label" htmlFor="mg-model">{t('vis.gateModel')}</label>
          <select id="mg-model" className="input h-8" value={model} onChange={(e) => setModel(e.target.value)}>
            {(models.data?.items ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
        <div><label className="field-label" htmlFor="mg-ver">{t('vis.gateVersion')}</label>
          <select id="mg-ver" className="input h-8" value={version} onChange={(e) => setVersion(e.target.value)}>
            {active.length === 0 && <option value="">{t('vis.none')}</option>}
            {active.map((v) => <option key={v.id} value={v.id}>v{v.version}</option>)}</select></div>
        <div><label className="field-label" htmlFor="mg-acc">{t('vis.gateAcc')}</label>
          <input id="mg-acc" type="number" min={0} max={100} className="input h-8 w-24" value={acc} disabled={!admin} aria-invalid={bad === 'acc' || undefined} onChange={(e) => setAcc(e.target.value)} /></div>
        <div><label className="field-label" htmlFor="mg-ns">{t('vis.gateSamples')}</label>
          <input id="mg-ns" type="number" min={1} max={100000} className="input h-8 w-24" value={ns} disabled={!admin} aria-invalid={bad === 'ns' || undefined} onChange={(e) => setNs(e.target.value)} /></div>
        {admin && <button type="button" className="btn btn-sm" disabled={!model || !!bad || save.isPending} onClick={() => save.mutate()}>{t('vis.gateSave')}</button>}
        {passed != null && <span role="status" className={passed ? 'text-[var(--color-ok)]' : 'text-[var(--color-danger)]'}>{passed ? t('vis.gatePass') : t('vis.gateFail')}</span>}
      </div>
      {bad && <p className="text-[12px] text-[var(--color-danger)]">{t(bad === 'acc' ? 'vis.errGateAcc' : 'vis.errGateNs')}</p>}
      {admin && version && (
        <div className="flex flex-wrap items-end gap-3 text-[13px]">
          <div><label className="field-label" htmlFor="mg-to">{t('vis.rollbackTo')}</label>
            <select id="mg-to" className="input h-8" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">{t('vis.none')}</option>
              {active.filter((v) => v.id !== version).map((v) => <option key={v.id} value={v.id}>v{v.version}</option>)}</select></div>
          <button type="button" className="btn btn-sm btn-ghost" disabled={!to || back.isPending} onClick={() => setAsk(true)}>{t('vis.rollback')}</button>
        </div>)}
      {ask && <Confirm title={t('vis.rollbackTitle', { from: verName(version), to: verName(to) })} body={t('vis.rollbackBody')} confirm={t('vis.rollback')} onYes={() => back.mutate()} onNo={() => setAsk(false)} />}
    </section>
  );
}
