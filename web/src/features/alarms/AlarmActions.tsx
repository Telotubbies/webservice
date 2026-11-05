// Alarm lifecycle actions (roadmap §7 3.4/3.5) — shelve/unshelve, assign,
// comment + event timeline, and the signed single-use mobile ack link.
// Everything writes through notifyApi (org-scoped v2 endpoints); the backend
// audits each action. Operator role required — viewers see the read-only
// timeline only.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '../../lib/api';
import { notifyApi } from '../notify/api';
import { Card } from '../../shared/ui/Page';
import { Icon } from '../../shared/ui/Icon';
import type { Alarm } from '../../types';
import '../notify/i18n';
import './i18n';

const SHELF_MINUTES = [60, 240, 480, 1440, 10080] as const;

export function AlarmActions({ alarm, orgId, operable }: {
  alarm: Alarm; orgId: string | null; operable: boolean;
}) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const aid = String(alarm.id);
  const shelved = !!alarm.shelved_until && Date.parse(alarm.shelved_until) > Date.now();
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [mins, setMins] = useState<number>(480);
  const [reason, setReason] = useState('');
  const [assignee, setAssignee] = useState('');
  const [comment, setComment] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [linkTtlS, setLinkTtlS] = useState(0);
  const [copied, setCopied] = useState(false);

  const events = useQuery({
    queryKey: ['alarm-events', orgId, aid],
    queryFn: () => notifyApi.alarmEvents(orgId!, aid),
    enabled: !!orgId,
  });
  // member list for the assign picker — same member-read endpoint the teams
  // page uses; a 403 just leaves the picker empty, never crashes the page
  const members = useQuery({
    queryKey: ['members', orgId],
    queryFn: () => adminApi.members(orgId!),
    enabled: !!orgId && operable,
    retry: false,
  });

  const fail = (key: string) => { setMsg(''); setErr(t(key)); };
  const ok = (key: string) => { setErr(''); setMsg(t(key)); };
  const refresh = () => void qc.invalidateQueries({ queryKey: ['alarm-events', orgId, aid] });

  const shelve = useMutation({
    mutationFn: () => notifyApi.shelve(orgId!, aid, mins, reason.trim()),
    onSuccess: (r) => { refresh(); setErr(''); setMsg(t('al.shelveDone', { at: new Date(r.shelved_until).toLocaleString(i18n.language) })); },
    onError: () => fail('al.shelveFail'),
  });
  const unshelve = useMutation({
    mutationFn: () => notifyApi.unshelve(orgId!, aid),
    onSuccess: () => { refresh(); ok('al.assignDone'); },
    onError: () => fail('al.shelveFail'),
  });
  const assign = useMutation({
    mutationFn: (uid: string | null) => notifyApi.assign(orgId!, aid, uid),
    onSuccess: () => { refresh(); ok('al.assignDone'); },
    onError: () => fail('al.assignFail'),
  });
  const postComment = useMutation({
    mutationFn: () => notifyApi.comment(orgId!, aid, comment.trim()),
    onSuccess: () => { setComment(''); refresh(); },
    onError: () => fail('al.commentFail'),
  });
  const makeLink = useMutation({
    mutationFn: () => notifyApi.ackLink(orgId!, aid),
    onSuccess: (r) => { setLink(`${window.location.origin}${r.url}`); setLinkTtlS(r.expires_in); setErr(''); },
    onError: () => fail('al.ackLinkFail'),
  });

  if (!orgId) return null;
  const memberItems = (members.data?.items ?? []).filter((m) => !m.disabled);

  return (
    <Card title={t('al.actions')}>
      <div className="space-y-3">
        {/* shelve strip */}
        {operable && (
          <div className="flex flex-wrap items-center gap-2">
            {shelved ? (
              <>
                <span className="text-[12px] font-semibold text-ink-68">
                  {t('al.shelvedBadge', { at: new Date(alarm.shelved_until!).toLocaleString(i18n.language) })}
                </span>
                <button type="button" className="btn btn-sm" disabled={unshelve.isPending}
                  onClick={() => unshelve.mutate()}>{t('al.unshelve')}</button>
              </>
            ) : (
              <>
                <label className="text-[12px] text-ink-68" htmlFor="al-shelf-mins">{t('al.shelveFor')}</label>
                <select id="al-shelf-mins" className="input h-8 w-28" value={mins}
                  onChange={(e) => setMins(Number(e.target.value))}>
                  {SHELF_MINUTES.map((m) => <option key={m} value={m}>{t(`al.m${m}`)}</option>)}
                </select>
                <input className="input h-8 w-40" value={reason} maxLength={500}
                  placeholder={t('al.shelveReason')} aria-label={t('al.shelveReason')}
                  onChange={(e) => setReason(e.target.value)} />
                <button type="button" className="btn btn-sm" disabled={shelve.isPending}
                  onClick={() => shelve.mutate()}>{t('al.shelve')}</button>
              </>
            )}
          </div>
        )}

        {/* assign + mobile ack link */}
        {operable && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[12px] text-ink-68" htmlFor="al-assignee">{t('al.assignTo')}</label>
            <select id="al-assignee" className="input h-8 w-44" value={assignee}
              onChange={(e) => setAssignee(e.target.value)}>
              <option value="">{t('al.unassign')}</option>
              {memberItems.map((m) => (
                <option key={m.user_id} value={m.user_id}>{m.display_name || m.sub}</option>
              ))}
            </select>
            <button type="button" className="btn btn-sm" disabled={assign.isPending}
              onClick={() => assign.mutate(assignee || null)}>{t('al.assign')}</button>
            <span className="text-[12px] text-ink-46">
              {alarm.assigned_name ? `${t('al.assignTo')}: ${alarm.assigned_name}` : ''}
            </span>
          </div>
        )}
        {operable && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-ink-68">{t('al.ackLink')}</span>
            <button type="button" className="btn btn-sm btn-ghost" disabled={makeLink.isPending}
              onClick={() => makeLink.mutate()}>
              {makeLink.isPending ? t('al.ackLinkBusy') : t('al.ackLinkMake')}
            </button>
            {link && (
              <>
                <code className="max-w-64 truncate rounded bg-subtle px-1.5 py-0.5 font-mono text-[11px]">{link}</code>
                <button type="button" className="btn btn-sm btn-ghost"
                  onClick={() => void navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {})}>
                  <Icon name="copy" size={12} /> {copied ? t('al.ackLinkCopied') : t('al.ackLinkCopy')}
                </button>
              </>
            )}
            {link && <span className="basis-full text-[11px] text-ink-46">{t('al.ackLinkHint', { mins: Math.round(linkTtlS / 60) })}</span>}
          </div>
        )}
        {(err || msg) && (
          <p className={`text-[12px] ${err ? 'text-[var(--color-danger)]' : 'text-[var(--color-ok)]'}`} role={err ? 'alert' : 'status'}>{err || msg}</p>
        )}

        {/* timeline */}
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-46">{t('al.comments')}</p>
          {(events.data?.items ?? []).length === 0 ? (
            <p className="text-[12px] text-ink-46">{t('al.eventsEmpty')}</p>
          ) : (
            <ul className="space-y-1">
              {(events.data?.items ?? []).map((ev, i) => (
                <li key={i} className="flex items-baseline gap-2 text-[12px]">
                  <span className="shrink-0 rounded bg-subtle px-1.5 text-[11px] font-medium text-ink-68">
                    {t(`al.ev_${ev.kind}`, { defaultValue: ev.kind })}
                  </span>
                  <span className="min-w-0 flex-1 text-ink-68">
                    {ev.body && <span className="text-ink">{ev.body} </span>}
                    <span className="text-ink-46">{ev.author}</span>
                  </span>
                  <time className="shrink-0 font-mono text-[11px] tabular-nums text-ink-46" dateTime={ev.at}>
                    {new Date(ev.at).toLocaleString(i18n.language, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}
                  </time>
                </li>
              ))}
            </ul>
          )}
          {operable && (
            <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (comment.trim()) postComment.mutate(); }}>
              <input className="input h-8 flex-1" value={comment} maxLength={2000}
                placeholder={t('al.commentPh')} aria-label={t('al.commentPh')}
                onChange={(e) => setComment(e.target.value)} />
              <button type="submit" className="btn btn-sm" disabled={postComment.isPending || !comment.trim()}>
                {t('al.commentAdd')}
              </button>
            </form>
          )}
        </div>
      </div>
    </Card>
  );
}
