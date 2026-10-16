// On-call panel per team (roadmap §7 3.3): current assignee (rotation or
// active override), the ordered weekly rotation editor, and overrides —
// one member pinned for a window while the rotation keeps running under it.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notifyApi, type OnCallNow } from '../notify/api';
import '../notify/i18n';

interface Member { user_id: string; display_name: string | null; sub: string }

const HANDOFFS = [
  { s: 43200, key: 'oc.h12' }, { s: 86400, key: 'oc.d1' }, { s: 604800, key: 'oc.d7' },
] as const;

export function OnCallPanel({ orgId, team, admin, all }: {
  orgId: string; team: { id: string; name: string }; admin: boolean;
  all: Member[];
}) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [ovOpen, setOvOpen] = useState(false);
  const [err, setErr] = useState('');

  const now = useQuery({
    queryKey: ['oncall', orgId],
    queryFn: () => notifyApi.oncall(orgId),
    enabled: !!orgId,
  });
  const overrides = useQuery({
    queryKey: ['oncall-ov', orgId, team.id],
    queryFn: () => notifyApi.overrides(orgId, team.id),
    enabled: !!orgId,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['oncall', orgId] });
    void qc.invalidateQueries({ queryKey: ['oncall-ov', orgId, team.id] });
  };

  const entry: OnCallNow | undefined = (now.data?.items ?? []).find((x) => x.team_id === team.id);
  const memberName = (id: string) =>
    all.find((m) => m.user_id === id)?.display_name
    ?? all.find((m) => m.user_id === id)?.sub ?? id.slice(0, 8);

  const fail = () => setErr(t('oc.failed'));
  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-46">{t('oc.now')}</span>
        {entry?.user_id ? (
          <span className="text-[13px] font-semibold text-ink">
            {entry.name ?? memberName(entry.user_id)}
            <span className="ml-1 font-normal text-ink-46">
              ({t(entry.source === 'override' ? 'oc.override' : 'oc.rotation')})
            </span>
          </span>
        ) : (
          <span className="text-[12px] italic text-ink-46">{t('oc.none')}</span>
        )}
      </div>
      {err && <p className="mt-1 text-[12px] text-[var(--color-danger)]" role="alert">{err}</p>}
      {admin && (
        <div className="mt-1.5 flex gap-2">
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing((v) => !v)}>
            {t('oc.editRot')}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOvOpen((v) => !v)}>
            {t('oc.addOv')}
          </button>
        </div>
      )}
      {admin && editing && (
        <RotationEditor orgId={orgId} team={team.id} all={all}
          current={entry?.rotation ?? []}
          onSaved={() => { refresh(); setEditing(false); }} onFail={fail}
          onClose={() => setEditing(false)} />
      )}
      {admin && ovOpen && (
        <OverrideForm orgId={orgId} team={team.id} all={all}
          onSaved={() => { refresh(); setOvOpen(false); }} onFail={fail}
          onClose={() => setOvOpen(false)} />
      )}
      {(overrides.data?.items ?? []).length > 0 && (
        <ul className="mt-2 space-y-1">
          {(overrides.data?.items ?? []).map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-x-2 text-[12px] text-ink-68">
              <span className="font-medium text-ink">{o.name ?? memberName(o.user_id)}</span>
              <span className="font-mono text-[11px]">
                {new Date(o.starts_at).toLocaleDateString(i18n.language)} → {new Date(o.ends_at).toLocaleDateString(i18n.language)}
              </span>
              {admin && (
                <button type="button" className="text-[var(--color-danger)] hover:underline"
                  onClick={() => void notifyApi.delOverride(orgId, team.id, o.id).then(refresh).catch(fail)}>
                  {t('oc.delOv')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RotationEditor({ orgId, team, all, current, onSaved, onFail, onClose }: {
  orgId: string; team: string; all: Member[]; current: string[];
  onSaved: () => void; onFail: () => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  const [ids, setIds] = useState<string[]>(current);
  const [handoff, setHandoff] = useState(604800);
  const [pick, setPick] = useState('');

  const save = useMutation({
    mutationFn: () => notifyApi.setRotation(orgId, team, { user_ids: ids, handoff_s: handoff }),
    onSuccess: onSaved, onError: onFail,
  });
  const move = (i: number, d: number) => setIds((v) => {
    const n = [...v]; const j = i + d;
    if (j < 0 || j >= n.length) return v;
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });
  const days = Math.round(handoff / 86400 * 10) / 10;

  return (
    <div className="mt-2 rounded border border-line p-2">
      <p className="text-[11px] text-ink-46">{t('oc.rotHint', { days })}</p>
      <ol className="mt-1 space-y-0.5">
        {ids.map((id, i) => (
          <li key={id} className="flex items-center gap-1.5 text-[12px]">
            <span className="w-4 text-right font-mono text-[11px] text-ink-46">{i + 1}.</span>
            <span className="min-w-0 flex-1 truncate">{all.find((m) => m.user_id === id)?.display_name ?? id.slice(0, 8)}</span>
            <button type="button" className="text-ink-46 hover:text-ink" aria-label={t('oc.moveUp')} onClick={() => move(i, -1)}>↑</button>
            <button type="button" className="text-ink-46 hover:text-ink" aria-label={t('oc.moveDown')} onClick={() => move(i, 1)}>↓</button>
            <button type="button" className="text-[var(--color-danger)]" aria-label={t('oc.remove')} onClick={() => setIds((v) => v.filter((_, j) => j !== i))}>×</button>
          </li>
        ))}
      </ol>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select className="input h-7 w-40 text-[12px]" value={pick} aria-label={t('oc.pickMember')}
          onChange={(e) => setPick(e.target.value)}>
          <option value="">{t('oc.pickMember')}</option>
          {all.filter((m) => !ids.includes(m.user_id)).map((m) => (
            <option key={m.user_id} value={m.user_id}>{m.display_name || m.sub}</option>
          ))}
        </select>
        <button type="button" className="btn btn-sm btn-ghost" disabled={!pick}
          onClick={() => { if (pick) { setIds((v) => [...v, pick]); setPick(''); } }}>
          {t('oc.addToRot')}
        </button>
        <label className="text-[11px] text-ink-46" htmlFor={`oc-ho-${team}`}>{t('oc.handoff')}</label>
        <select id={`oc-ho-${team}`} className="input h-7 text-[12px]" value={handoff}
          onChange={(e) => setHandoff(Number(e.target.value))}>
          {HANDOFFS.map((h) => <option key={h.s} value={h.s}>{t(h.key)}</option>)}
        </select>
      </div>
      <div className="mt-2 flex gap-2">
        <button type="button" className="btn btn-sm" disabled={save.isPending}
          onClick={() => save.mutate()}>{t('oc.saveRot')}</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>{t('common.close')}</button>
      </div>
    </div>
  );
}

function OverrideForm({ orgId, team, all, onSaved, onFail, onClose }: {
  orgId: string; team: string; all: Member[];
  onSaved: () => void; onFail: () => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  const [uid, setUid] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const add = useMutation({
    mutationFn: () => notifyApi.addOverride(orgId, team, {
      user_id: uid, starts_at: new Date(from).toISOString(), ends_at: new Date(to).toISOString(),
    }),
    onSuccess: onSaved, onError: onFail,
  });
  const ok = uid && from && to && Date.parse(to) > Date.parse(from);
  return (
    <form className="mt-2 flex flex-wrap items-center gap-2 rounded border border-line p-2"
      onSubmit={(e) => { e.preventDefault(); if (ok) add.mutate(); }}>
      <select className="input h-7 w-40 text-[12px]" value={uid} required aria-label={t('oc.member')}
        onChange={(e) => setUid(e.target.value)}>
        <option value="">{t('oc.pickMember')}</option>
        {all.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name || m.sub}</option>)}
      </select>
      <label className="text-[11px] text-ink-46" htmlFor={`ov-f-${team}`}>{t('oc.ovFrom')}</label>
      <input id={`ov-f-${team}`} type="datetime-local" className="input h-7 text-[12px]" required
        value={from} onChange={(e) => setFrom(e.target.value)} />
      <label className="text-[11px] text-ink-46" htmlFor={`ov-t-${team}`}>{t('oc.ovTo')}</label>
      <input id={`ov-t-${team}`} type="datetime-local" className="input h-7 text-[12px]" required
        value={to} onChange={(e) => setTo(e.target.value)} />
      <button type="submit" className="btn btn-sm" disabled={!ok || add.isPending}>{t('oc.addOv')}</button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>{t('common.close')}</button>
    </form>
  );
}
