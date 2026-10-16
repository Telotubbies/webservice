// Teams — named groups of org members (owners of incidents). Everyone reads;
// admins create / delete teams and edit membership.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, adminApi, teamApi, type TeamRow } from '../../lib/api';
import { useAdminOrg } from '../admin/admin';
import { OnCallPanel } from './OnCallPanel';
import { canAdmin, useRole } from '../../app/session';
import { EmptyState, Notice } from '../../shared/ui/Feedback';
import { ProductHeader } from '../../shared/ui/Product';

export function TeamsPage() {
  const { t } = useTranslation();
  const admin = canAdmin(useRole());
  const { orgId } = useAdminOrg();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['teams', orgId], queryFn: () => teamApi.list(orgId!), enabled: !!orgId });
  const members = useQuery({ queryKey: ['members', orgId], queryFn: () => adminApi.members(orgId!), enabled: !!orgId && admin });
  const done = () => qc.invalidateQueries({ queryKey: ['teams', orgId] });
  const create = useMutation({ mutationFn: (name: string) => teamApi.create(orgId!, { name, description: '' }), onSuccess: done });
  const setMembers = useMutation({ mutationFn: (v: { id: string; ids: string[] }) => teamApi.setMembers(orgId!, v.id, v.ids), onSuccess: done });
  const remove = useMutation({ mutationFn: (id: string) => teamApi.remove(orgId!, id), onSuccess: done });
  const [name, setName] = useState('');
  const err = list.error ?? create.error ?? setMembers.error ?? remove.error;
  const teams = list.data?.teams ?? [];

  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader icon="on-call" title={t('team.title')} />
      {err && <div className="px-4 pt-2"><Notice>{err instanceof ApiError && err.status === 409 ? t('team.duplicate') : t('team.failed')}</Notice></div>}
      <div className="p-4">
        {admin && (
          <form className="mb-3 flex max-w-md gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { create.mutate(name.trim()); setName(''); } }}>
            <input className="input flex-1" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={t('team.namePh')} aria-label={t('team.namePh')} />
            <button type="submit" className="btn btn-sm" disabled={!name.trim()}>{t('team.create')}</button>
          </form>
        )}
        {teams.length === 0 ? <EmptyState title={t('team.empty')} icon="search" /> : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {teams.map((tm) => (
              <TeamCard key={tm.id} team={tm} admin={admin} orgId={orgId!}
                all={(members.data?.items ?? []).filter((m) => !m.disabled)}
                onSave={(ids) => setMembers.mutate({ id: tm.id, ids })} onDelete={() => remove.mutate(tm.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TeamCard({ team, admin, orgId, all, onSave, onDelete }: {
  team: TeamRow; admin: boolean; orgId: string;
  all: { user_id: string; display_name: string | null; sub: string }[];
  onSave: (ids: string[]) => void; onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const start = () => { setSel(new Set(team.members.map((m) => m.user_id))); setEditing(true); };
  const flip = (id: string) => setSel((s) => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; });
  return (
    <section className="rounded-[5px] border border-line bg-white p-4 text-[13px]">
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold">{team.name}</h2>
        <span className="font-mono text-[11px] text-ink-46">{t('team.count', { count: team.members.length })}</span>
      </div>
      {editing ? (
        <>
          <div className="mt-2 max-h-44 overflow-y-auto rounded border border-line p-2">
            {all.map((m) => (
              <label key={m.user_id} className="flex items-center gap-2 py-0.5 text-[12px]">
                <input type="checkbox" checked={sel.has(m.user_id)} onChange={() => flip(m.user_id)} /> {m.display_name || m.sub}
              </label>
            ))}
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(false)}>{t('common.close')}</button>
            <button type="button" className="btn btn-sm" onClick={() => { onSave([...sel]); setEditing(false); }}>{t('team.save')}</button>
          </div>
        </>
      ) : (
        <>
          <ul className="mt-2 min-h-6 text-ink-68">
            {team.members.length === 0 ? <li className="italic text-ink-46">{t('team.noMembers')}</li> : team.members.map((m) => <li key={m.user_id}>{m.name}</li>)}
          </ul>
          {admin && (
            <div className="mt-2 flex gap-2">
              <button type="button" className="btn btn-sm btn-ghost" onClick={start}>{t('team.editMembers')}</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => { if (confirm(t('team.confirmDelete', { name: team.name }))) onDelete(); }}>{t('team.delete')}</button>
            </div>
          )}
          <OnCallPanel orgId={orgId} team={team} admin={admin} all={all} />
        </>
      )}
    </section>
  );
}
