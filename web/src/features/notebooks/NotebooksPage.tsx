// Notebooks — org markdown notes. List with search + "new", and a view page:
// read mode renders markdown (react-markdown: no raw HTML), edit mode is a
// textarea beside a live preview. Persisted per org via notebookApi.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Markdown from 'react-markdown';
import { ApiError, notebookApi, type NotebookRow } from '../../lib/api';
import { useAdminOrg } from '../admin/admin';
import { Confirm } from '../../shared/ui/Confirm';
import { EmptyState, Notice, PageSkeleton } from '../../shared/ui/Feedback';
import { ProductHeader } from '../../shared/ui/Product';

const fmt = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

function useNotebooks() {
  const { orgId, orgRole } = useAdminOrg();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['notebooks', orgId], queryFn: () => notebookApi.list(orgId!), enabled: !!orgId });
  const refresh = () => qc.invalidateQueries({ queryKey: ['notebooks', orgId] });
  return { orgId, canWrite: orgRole !== null && orgRole !== 'viewer', list, refresh };
}

export function NotebooksPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { orgId, canWrite, list, refresh } = useNotebooks();
  const [q, setQ] = useState('');
  const [params, setParams] = useSearchParams();
  const create = useMutation({
    mutationFn: () => notebookApi.create(orgId!, { id: crypto.randomUUID(), title: t('notebook.untitled'), body: '', shared: true }),
    onSuccess: (r) => { void refresh(); nav(`/notebooks/${r.notebook.id}?edit=1`); },
  });
  // the nav flyout's "New notebook" lands here as ?new=1
  useEffect(() => {
    if (params.get('new') && canWrite && orgId && !create.isPending) { setParams({}, { replace: true }); create.mutate(); }
  }, [params, canWrite, orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => (list.data?.notebooks ?? []).filter((n) => n.title.toLowerCase().includes(q.toLowerCase())), [list.data, q]);

  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader icon="notebook" title={t('notebook.title')} actions={canWrite && (
        <button type="button" className="btn btn-sm" disabled={create.isPending} onClick={() => create.mutate()}>{t('notebook.new')}</button>
      )} />
      <div className="border-b border-line bg-white px-4 py-2">
        <input className="input w-full" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('notebook.searchPh')} aria-label={t('notebook.searchPh')} />
      </div>
      {(list.error || create.error) && <div className="px-4 pt-2"><Notice>{t('notebook.failed')}</Notice></div>}
      <div className="p-4">
        {list.isLoading ? <PageSkeleton /> : rows.length === 0 ? <EmptyState title={t('notebook.empty')} icon="search" /> : (
          <table className="w-full border-collapse rounded-[5px] border border-line bg-white text-[13px]">
            <thead><tr className="border-b border-line text-left">
              {['colTitle', 'colVisibility', 'colUpdated'].map((c) => (
                <th key={c} scope="col" className="h-8 px-3 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-68">{t(`notebook.${c}`)}</th>
              ))}
            </tr></thead>
            <tbody>
              {rows.map((n) => (
                <tr key={n.id} className="h-10 border-b border-line last:border-0 hover:bg-info-soft">
                  <td className="px-3 font-medium"><Link className="text-blue hover:underline" to={`/notebooks/${n.id}`}>{n.title}</Link></td>
                  <td className="px-3 text-ink-68">{n.shared ? t('notebook.shared') : t('notebook.private')}{n.mine ? ` · ${t('notebook.mine')}` : ''}</td>
                  <td className="whitespace-nowrap px-3 font-mono text-[12px]">{fmt(n.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function NotebookViewPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { orgId, canWrite, list, refresh } = useNotebooks();
  const nb = list.data?.notebooks.find((n) => n.id === id);
  const [edit, setEdit] = useState(params.get('edit') === '1');
  const [draft, setDraft] = useState<NotebookRow | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  useEffect(() => { if (nb && !draft) setDraft(nb); }, [nb, draft]);

  const save = useMutation({
    mutationFn: (d: NotebookRow) => notebookApi.update(orgId!, d.id, { title: d.title.trim() || t('notebook.untitled'), body: d.body, shared: d.shared, base_updated_at: d.updated_at }),
    onSuccess: () => { void refresh(); setEdit(false); setDraft(null); },
  });
  const del = useMutation({ mutationFn: () => notebookApi.remove(orgId!, id!), onSuccess: () => { void refresh(); nav('/notebooks'); } });

  if (list.isLoading) return <PageSkeleton />;
  if (!nb || !draft) return <EmptyState title={t('notebook.notFound')} icon="search" action={<Link className="btn btn-sm" to="/notebooks">{t('notebook.back')}</Link>} />;
  // the server enforces author-or-admin; a 403 surfaces as the failed notice
  const body = edit ? draft.body : nb.body;

  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader icon="notebook" title={edit ? t('notebook.edit') : nb.title} back={{ to: '/notebooks', label: t('notebook.back') }} actions={canWrite && (
        edit ? (<>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setEdit(false); setDraft(nb); }}>{t('common.close')}</button>
          <button type="button" className="btn btn-sm" disabled={save.isPending} onClick={() => save.mutate(draft)}>{t('notebook.save')}</button>
        </>) : (<>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmDel(true)}>{t('notebook.delete')}</button>
          <button type="button" className="btn btn-sm" onClick={() => setEdit(true)}>{t('notebook.edit')}</button>
        </>)
      )} />
      {(save.error || del.error) && <div className="px-4 pt-2"><Notice>{save.error instanceof ApiError && save.error.status === 409 ? t('notebook.conflict') : t('notebook.failed')}</Notice></div>}
      <div className={`grid flex-1 gap-4 p-4 ${edit ? 'md:grid-cols-2' : ''}`}>
        {edit && (
          <div className="flex flex-col gap-2">
            <input className="input" value={draft.title} maxLength={120} aria-label={t('notebook.colTitle')} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            <textarea className="input min-h-[420px] flex-1 font-mono text-[13px]" value={draft.body} maxLength={100000} aria-label={t('notebook.body')} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={draft.shared} onChange={(e) => setDraft({ ...draft, shared: e.target.checked })} /> {t('notebook.shareOrg')}
            </label>
          </div>
        )}
        <article className="min-w-0 rounded-[5px] border border-line bg-white p-4 text-[14px] leading-relaxed [&_a]:text-blue [&_code]:font-mono [&_h1]:text-[20px] [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:text-[16px] [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p]:my-2 [&_pre]:overflow-x-auto [&_pre]:bg-subtle [&_pre]:p-2">
          {body.trim() ? <Markdown>{body}</Markdown> : <p className="text-ink-46">{t('notebook.emptyBody')}</p>}
        </article>
      </div>
      {confirmDel && <Confirm title={t('notebook.delete')} body={t('notebook.deleteBody', { name: nb.title })} confirm={t('notebook.delete')} onYes={() => del.mutate()} onNo={() => setConfirmDel(false)} />}
    </div>
  );
}
