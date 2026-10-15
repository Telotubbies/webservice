// Incidents — declare, acknowledge and resolve problems with an append-only
// timeline. Facets (status / severity), table, detail drawer with notes.

import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, incidentApi, type IncidentSeverity } from '../../lib/api';
import { useAdminOrg } from '../admin/admin';
import { canOperate, useRole } from '../../app/session';
import { DdIcon } from '../../shared/ui/DdIcon';
import { EmptyState, Notice } from '../../shared/ui/Feedback';
import { SeverityBadge } from '../../shared/ui/Status';
import { FacetGroup, ProductHeader, facetOptions, toggleIn } from '../../shared/ui/Product';

const fmt = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const STATUS_STYLE = {
  active: 'bg-[#fde8ea] text-[#a3263c]',
  acknowledged: 'bg-[var(--color-caution-soft)] text-[#8a5a00]',
  resolved: 'bg-[#e6f5ec] text-[#1c6b45]',
};

export function IncidentsPage() {
  const { t } = useTranslation();
  const operable = canOperate(useRole());
  const { orgId } = useAdminOrg();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['incidents', orgId], queryFn: () => incidentApi.list(orgId!), enabled: !!orgId, refetchInterval: 30_000 });
  const done = () => { qc.invalidateQueries({ queryKey: ['incidents', orgId] }); qc.invalidateQueries({ queryKey: ['incident', orgId] }); };
  const create = useMutation({ mutationFn: (b: Parameters<typeof incidentApi.create>[1]) => incidentApi.create(orgId!, b), onSuccess: done });
  const [offStatus, setOffStatus] = useState<Set<string>>(new Set(['resolved']));
  const [offSev, setOffSev] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const dlg = useRef<HTMLDialogElement>(null);

  const rows = useMemo(() => list.data?.incidents ?? [], [list.data]);
  const shown = useMemo(() => rows
    .filter((i) => !offStatus.has(i.status) && !offSev.has(i.severity))
    .filter((i) => `${i.title} ${i.team ?? ''}`.toLowerCase().includes(q.toLowerCase())), [rows, offStatus, offSev, q]);
  const err = create.error ?? list.error;

  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader icon="incidents" title={t('inc.title')} />
      <div className="flex items-center gap-2 border-b border-line bg-white px-4 py-2">
        <input className="input flex-1 font-mono" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('inc.queryPh')} aria-label={t('inc.queryPh')} />
      </div>
      {err && <div className="px-4 pt-2"><Notice>{err instanceof ApiError && err.status === 403 ? t('inc.needOperator') : t('inc.failed')}</Notice></div>}

      <div className="flex flex-1 gap-4 p-4 pt-2">
        <aside className="w-[220px] shrink-0 self-start border border-line bg-white" aria-label={t('inc.facets')}>
          <FacetGroup title={t('inc.facetStatus')} off={offStatus} emptyLabel={t('slos.noValues')}
            onToggle={(v) => setOffStatus((s) => toggleIn(s, v))}
            options={facetOptions(rows, (i) => i.status, (v) => t(`inc.status.${v}`))} />
          <FacetGroup title={t('inc.facetSeverity')} off={offSev} emptyLabel={t('slos.noValues')}
            onToggle={(v) => setOffSev((s) => toggleIn(s, v))}
            options={facetOptions(rows, (i) => i.severity, (v) => t(`alarms.${v}`))} />
        </aside>

        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center">
            <span className="text-[12px] text-ink-68">{t('slos.showing', { shown: shown.length, total: rows.length })}</span>
            <span className="flex-1" />
            {operable ? (
              <button type="button" onClick={() => dlg.current?.showModal()}
                className="flex h-8 items-center gap-1.5 rounded bg-blue px-3 text-[13px] text-white focus-visible:outline-2 focus-visible:outline-blue">
                <DdIcon name="incidents" size={13} /> {t('inc.declare')}
              </button>
            ) : <span className="text-[11px] text-ink-46">{t('inc.needOperator')}</span>}
          </div>

          <section className="overflow-x-auto rounded-[5px] border border-line bg-white">
            {shown.length === 0 ? <EmptyState title={t('slos.empty')} icon="search" /> : (
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left">
                    {['colStatus', 'colSeverity', 'colTitle', 'colTeam', 'colOpened'].map((c) => (
                      <th key={c} scope="col" className="h-8 px-3 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-68">{t(`inc.${c}`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((i) => (
                    <tr key={i.id} className="h-10 cursor-pointer border-b border-line last:border-0 hover:bg-info-soft" onClick={() => setOpen(open === i.id ? null : i.id)}>
                      <td className="px-3"><span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[i.status]}`}>{t(`inc.status.${i.status}`)}</span></td>
                      <td className="px-3"><SeverityBadge severity={i.severity} /></td>
                      <td className="px-3 font-medium">
                        <button type="button" className="text-left text-blue hover:underline focus-visible:outline-2 focus-visible:outline-blue" aria-expanded={open === i.id}>{i.title}</button>
                      </td>
                      <td className="px-3 text-ink-68">{i.team ?? '—'}</td>
                      <td className="whitespace-nowrap px-3 font-mono text-[12px]">{fmt(i.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          {open && orgId && <Detail orgId={orgId} id={open} operable={operable} onChange={done} />}
        </div>
      </div>

      <DeclareDialog dlgRef={dlg} teams={list.data?.teams ?? []} onSave={(b) => create.mutate(b)} />
    </div>
  );
}

function Detail({ orgId, id, operable, onChange }: { orgId: string; id: string; operable: boolean; onChange: () => void }) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const d = useQuery({ queryKey: ['incident', orgId, id], queryFn: () => incidentApi.get(orgId, id), refetchInterval: 15_000 });
  const status = useMutation({ mutationFn: (s: 'acknowledged' | 'resolved') => incidentApi.setStatus(orgId, id, s), onSuccess: onChange });
  const addNote = useMutation({ mutationFn: (b: string) => incidentApi.note(orgId, id, b), onSuccess: () => { setNote(''); onChange(); } });
  const inc = d.data?.incident;
  if (!inc) return null;
  return (
    <section className="mt-3 rounded-[5px] border border-line bg-white p-4" aria-label={inc.title}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{inc.title}</h2>
        {operable && inc.status === 'active' && <button type="button" className="btn btn-sm" onClick={() => status.mutate('acknowledged')}>{t('inc.ack')}</button>}
        {operable && inc.status !== 'resolved' && <button type="button" className="btn btn-sm" onClick={() => status.mutate('resolved')}>{t('inc.resolve')}</button>}
      </div>
      {(status.error || addNote.error) && <Notice>{t('inc.failed')}</Notice>}
      <ol className="mt-3 border-l border-line pl-3">
        {(d.data?.events ?? []).map((e, k) => (
          <li key={k} className="relative py-1 text-[12px]">
            <span className="absolute -left-[17px] top-2 h-2 w-2 rounded-full bg-blue" aria-hidden />
            <span className="font-mono text-ink-46">{fmt(e.at)}</span>{' '}
            <span className="font-semibold">{e.who}</span>{' '}
            <span className="text-ink-68">{e.kind === 'note' ? e.body : e.kind === 'created' ? t('inc.evCreated') : t(`inc.status.${e.body}`)}</span>
          </li>
        ))}
      </ol>
      {operable && (
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (note.trim()) addNote.mutate(note.trim()); }}>
          <input className="input flex-1" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder={t('inc.notePh')} aria-label={t('inc.notePh')} />
          <button type="submit" className="btn btn-sm" disabled={!note.trim()}>{t('inc.addNote')}</button>
        </form>
      )}
    </section>
  );
}

function DeclareDialog({ dlgRef, teams, onSave }: {
  dlgRef: React.RefObject<HTMLDialogElement | null>;
  teams: { id: string; name: string }[];
  onSave: (b: { title: string; severity: IncidentSeverity; owner_team_id: string | null }) => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [sev, setSev] = useState<IncidentSeverity>('warning');
  const [team, setTeam] = useState('');
  const [tried, setTried] = useState(false);
  const close = () => { dlgRef.current?.close(); setTried(false); };
  return (
    <dialog ref={dlgRef} className="m-auto w-[440px] rounded-[6px] border border-line p-0 shadow-pop backdrop:bg-black/40" aria-labelledby="inc-title">
      <form method="dialog" className="p-4" onSubmit={(e) => {
        e.preventDefault(); setTried(true);
        if (!title.trim()) return;
        onSave({ title: title.trim(), severity: sev, owner_team_id: team || null });
        setTitle(''); close();
      }}>
        <h2 id="inc-title" className="mb-3 text-[15px] font-semibold">{t('inc.declare')}</h2>
        <label className="block text-[12px] font-semibold text-ink-68" htmlFor="inc-t">{t('inc.colTitle')}</label>
        <input id="inc-t" className="input mt-1 w-full" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} aria-invalid={tried && !title.trim()} />
        {tried && !title.trim() && <p className="mt-1 text-[11px] text-[var(--color-danger)]" role="alert">{t('inc.errTitle')}</p>}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] font-semibold text-ink-68" htmlFor="inc-s">{t('inc.colSeverity')}</label>
            <select id="inc-s" className="input mt-1 w-full" value={sev} onChange={(e) => setSev(e.target.value as IncidentSeverity)}>
              {(['info', 'warning', 'critical'] as const).map((s) => <option key={s} value={s}>{t(`alarms.${s}`)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-ink-68" htmlFor="inc-team">{t('inc.colTeam')}</label>
            <select id="inc-team" className="input mt-1 w-full" value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="">—</option>
              {teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn btn-sm btn-ghost" onClick={close}>{t('common.close')}</button>
          <button type="submit" className="btn btn-sm">{t('inc.declare')}</button>
        </div>
      </form>
    </dialog>
  );
}
