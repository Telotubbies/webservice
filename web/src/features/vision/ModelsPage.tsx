// Infrastructure -> Models: the registry of the org's own YOLO26 models.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Upload } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { canAdmin } from '../../app/session';
import { useAdminOrg } from '../admin/admin';
import { Confirm } from '../../shared/ui/Confirm';
import { EmptyState, ErrorState, Notice, SkeletonRows } from '../../shared/ui/Feedback';
import { ProductHeader } from '../../shared/ui/Product';
import { DEVICE_TABS } from '../devices/tabs';
import { visionApi, type ModelVersion, type Task, type VisionModel } from './api';
import { modelFileError, nameCountError, namesFromText } from './logic';
import './i18n';

const mb = (n: number | null) => (n == null ? '—' : `${(n / 1048576).toFixed(1)} MB`);

function useFail() {
  const { t } = useTranslation();
  return (e: unknown): string => {
    if (!(e instanceof ApiError)) return t('dev.errNetwork');
    if (e.status === 413) return t('vis.errTooLarge');
    if (e.status === 409 && e.message === 'model_name_exists') return t('vis.errNameExists');
    if (e.status === 409 && e.message === 'version_pinned') return t('vis.errPinned');
    return t('vis.errGeneric', { reason: e.message });
  };
}

function VersionRow({ orgId, model, v, admin, onChanged, onError }: {
  orgId: string; model: VisionModel; v: ModelVersion; admin: boolean; onChanged: () => void; onError: (m: string) => void;
}) {
  const { t } = useTranslation();
  const fail = useFail();
  const [names, setNames] = useState('');
  const [attest, setAttest] = useState<boolean | null>(null);
  const [del, setDel] = useState(false);
  const done = { onSuccess: onChanged, onError: (e: unknown) => onError(fail(e)) };
  const classes = useMutation({
    mutationFn: () => visionApi.setClasses(orgId, model.id, v.id, namesFromText(names)), ...done,
  });
  const activate = useMutation({ mutationFn: () => visionApi.activate(orgId, model.id, v.id), ...done, onSuccess: () => { setAttest(null); onChanged(); } });
  const archive = useMutation({ mutationFn: () => visionApi.archive(orgId, model.id, v.id), ...done });
  const remove = useMutation({ mutationFn: () => visionApi.deleteVersion(orgId, model.id, v.id), ...done, onSuccess: () => { setDel(false); onChanged(); } });
  const parsed = namesFromText(names);
  const countErr = nameCountError(parsed, v.class_count);

  return (
    <>
      <tr className="border-b border-line last:border-0">
        <td className="px-3 py-2 font-medium">v{v.version}</td>
        <td className="px-3 py-2">{t(`vis.st_${v.status}`)}{v.status === 'failed' && v.failure_reason ? <span className="block max-w-[44ch] truncate text-[12px] text-[var(--color-danger)]" title={v.failure_reason}>{v.failure_reason}</span> : null}</td>
        <td className="px-3 py-2">{v.classes ? v.classes.length : '—'}</td>
        <td className="px-3 py-2">{mb(v.size_bytes)}</td>
        <td className="px-3 py-2">{v.imgsz ? `${v.imgsz} px` : '—'}</td>
        <td className="px-3 py-2 text-right whitespace-nowrap">
          {admin && v.status === 'draft' && v.classes && <button type="button" className="btn btn-sm" onClick={() => setAttest(false)}>{t('vis.activate')}</button>}
          {admin && v.status === 'active' && <button type="button" className="btn btn-sm btn-ghost" onClick={() => archive.mutate()}>{t('vis.archive')}</button>}
          {admin && ['draft', 'failed', 'archived'].includes(v.status) && (
            <button type="button" className="btn btn-sm btn-ghost" aria-label={`${t('vis.delete')} v${v.version}`} onClick={() => setDel(true)}><Trash2 size={14} aria-hidden /></button>
          )}
        </td>
      </tr>
      {admin && v.status === 'draft' && !v.classes && (
        <tr className="border-b border-line"><td colSpan={6} className="px-3 py-3">
          <p className="text-[13px] text-ink-68">{t('vis.needClasses')}</p>
          <textarea className="input mt-2 w-full max-w-md font-mono" rows={5} value={names} placeholder={t('vis.classesPlaceholder')} onChange={(e) => setNames(e.target.value)} aria-label={t('vis.needClasses')} />
          <p className="mt-1 text-[12px] text-ink-46">{t('vis.namesCount', { count: parsed.length })}</p>
          {names && countErr && <p className="text-[12px] text-[var(--color-danger)]">{countErr.got === 0 ? t('vis.errEmpty') : t('vis.errCount', { expected: countErr.expected, got: countErr.got })}</p>}
          <button type="button" className="btn btn-sm mt-2" disabled={!!countErr || classes.isPending} onClick={() => classes.mutate()}>{t('vis.saveClasses')}</button>
        </td></tr>
      )}
      {attest !== null && (
        <tr><td colSpan={6} className="px-3 py-3">
          <div className="rounded-[5px] border border-line bg-white p-3" role="group" aria-label={t('vis.attestTitle', { v: v.version })}>
            <h4 className="text-[14px] font-semibold">{t('vis.attestTitle', { v: v.version })}</h4>
            <p className="mt-1 text-[13px] text-ink-68">{t('vis.attestBody')}</p>
            <label className="mt-2 flex items-start gap-2 text-[13px]"><input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} />{t('vis.attest')}</label>
            <div className="mt-2 flex gap-2">
              <button type="button" className="btn btn-sm" disabled={!attest || activate.isPending} onClick={() => activate.mutate()}>{t('vis.activate')}</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAttest(null)}>{t('vis.cancel')}</button>
            </div>
          </div>
        </td></tr>
      )}
      {del && <tr><td colSpan={6}><Confirm title={t('vis.deleteTitle', { name: `${model.name} v${v.version}` })} body={t('vis.deleteBody')} confirm={t('vis.delete')} onYes={() => remove.mutate()} onNo={() => setDel(false)} /></td></tr>}
    </>
  );
}

function ModelCard({ orgId, model, admin, onModelChanged, onError }: {
  orgId: string; model: VisionModel; admin: boolean; onModelChanged: () => void; onError: (m: string) => void;
}) {
  const { t } = useTranslation();
  const fail = useFail();
  const qc = useQueryClient();
  const [del, setDel] = useState(false);
  const key = ['vis-versions', orgId, model.id];
  const versions = useQuery({
    queryKey: key, queryFn: () => visionApi.versions(orgId, model.id),
    refetchInterval: (q) => (q.state.data?.items.some((v) => v.status === 'processing') ? 3000 : false),
  });
  const refresh = () => { void qc.invalidateQueries({ queryKey: key }); onModelChanged(); };
  const upload = useMutation({
    mutationFn: async (f: File) => {
      const bad = modelFileError(f);
      if (bad) throw new ApiError(0, null, t(bad === 'type' ? 'vis.errType' : 'vis.errSize'));
      return visionApi.upload(orgId, model.id, f);
    },
    onSuccess: refresh, onError: (e) => onError(e instanceof ApiError && e.status === 0 ? e.message : fail(e)),
  });
  const remove = useMutation({
    mutationFn: () => visionApi.deleteModel(orgId, model.id),
    onSuccess: () => { setDel(false); onModelChanged(); }, onError: (e) => { setDel(false); onError(fail(e)); },
  });
  const items = versions.data?.items ?? [];

  return (
    <section className="rounded-[5px] border border-line bg-white" aria-label={model.name}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <h3 className="text-[14px] font-semibold">{model.name} <span className="ml-1 text-[12px] font-normal text-ink-46">{t(`vis.task_${model.task}`)}</span></h3>
        {admin && (
          <div className="flex items-center gap-1">
            <label className="btn btn-sm cursor-pointer">
              <Upload size={14} aria-hidden /> {upload.isPending ? t('vis.uploading') : t('vis.upload')}
              <input type="file" accept=".onnx,.pt" className="sr-only" disabled={upload.isPending}
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload.mutate(f); }} />
            </label>
            <button type="button" className="btn btn-sm btn-ghost" aria-label={`${t('vis.delete')} ${model.name}`} onClick={() => setDel(true)}><Trash2 size={14} aria-hidden /></button>
          </div>
        )}
      </header>
      {versions.isError ? <div className="p-3"><ErrorState compact onRetry={() => void versions.refetch()} /></div> : versions.isLoading ? <div className="p-3"><SkeletonRows rows={2} /></div> : items.length === 0 ? (
        <p className="px-3 py-3 text-[13px] text-ink-68">{t('vis.noVersions')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead><tr className="border-b border-line text-left">
              {['colVersion', 'colStatus', 'colClasses', 'colSize', 'colInput', 'colActions'].map((c) => <th key={c} scope="col" className="h-8 px-3 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-68">{t(`vis.${c}`)}</th>)}
            </tr></thead>
            <tbody>{items.map((v) => <VersionRow key={v.id} orgId={orgId} model={model} v={v} admin={admin} onChanged={refresh} onError={onError} />)}</tbody>
          </table>
        </div>
      )}
      {del && <Confirm title={t('vis.deleteTitle', { name: model.name })} body={t('vis.deleteBody')} confirm={t('vis.delete')} onYes={() => remove.mutate()} onNo={() => setDel(false)} />}
    </section>
  );
}

export function ModelsPage() {
  const { t } = useTranslation();
  const fail = useFail();
  const qc = useQueryClient();
  const { orgId, orgRole } = useAdminOrg();
  const admin = canAdmin(orgRole ?? 'none');
  const [msg, setMsg] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [task, setTask] = useState<Task>('detect');
  const key = ['vis-models', orgId];
  const list = useQuery({ queryKey: key, queryFn: () => visionApi.models(orgId!), enabled: !!orgId });
  const refresh = () => void qc.invalidateQueries({ queryKey: key });
  const create = useMutation({
    mutationFn: () => visionApi.createModel(orgId!, { name: name.trim(), task }),
    onSuccess: () => { setAdding(false); setName(''); setMsg(''); refresh(); }, onError: (e) => setMsg(fail(e)),
  });
  const items = list.data?.items ?? [];

  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader icon="server" title={t('dev.product')} tabs={DEVICE_TABS(t)} lede={t('vis.lede')}
        actions={admin ? <button type="button" className="btn btn-sm" onClick={() => setAdding(true)}><Plus size={14} aria-hidden /> {t('vis.newModel')}</button> : undefined} />
      <div className="flex-1 space-y-3 p-4">
        {!admin && <Notice tone="info">{t('vis.readOnly')}</Notice>}
        <Notice tone="info">{t('vis.convertHint')}</Notice>
        {msg && <Notice tone="error">{msg}</Notice>}
        {adding && (
          <form className="rounded-[5px] border border-line bg-white p-3" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}>
            <div className="flex flex-wrap items-end gap-3">
              <div><label className="field-label" htmlFor="vm-name">{t('vis.name')}</label><input id="vm-name" className="input h-8" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></div>
              <div><label className="field-label" htmlFor="vm-task">{t('vis.task')}</label>
                <select id="vm-task" className="input h-8" value={task} onChange={(e) => setTask(e.target.value as Task)}>
                  <option value="detect">{t('vis.task_detect')}</option><option value="segment">{t('vis.task_segment')}</option>
                </select></div>
              <button type="submit" className="btn btn-sm" disabled={!name.trim() || create.isPending}>{t('vis.create')}</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAdding(false)}>{t('vis.cancel')}</button>
            </div>
          </form>
        )}
        {list.isError ? <ErrorState onRetry={() => void list.refetch()} /> : list.isLoading || !orgId ? <SkeletonRows rows={3} /> : items.length === 0 ? (
          !adding && <EmptyState icon="info" title={t('vis.noModels')} body={t('vis.noModelsHint')} action={admin ? <button type="button" className="btn btn-sm" onClick={() => setAdding(true)}>{t('vis.newModel')}</button> : undefined} />
        ) : items.map((m) => <ModelCard key={m.id} orgId={orgId!} model={m} admin={admin} onModelChanged={refresh} onError={setMsg} />)}
      </div>
    </div>
  );
}
