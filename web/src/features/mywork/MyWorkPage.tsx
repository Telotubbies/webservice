// My work: open alarms, stops without a reason and truck decisions waiting for
// review in one list. Pick one and finish it in the panel beside it. Alarms come
// from the live store (so an ack removes the row at once); the other two lists
// are one query that every action invalidates.

import { Fragment, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../../lib/api';
import { fmtAge, fmtDateTime } from '../../lib/format';
import { canOperate } from '../../app/session';
import { PageBar, PageBody } from '../../shared/ui/Page';
import { EmptyState, ErrorState, PermissionNotice, SkeletonRows } from '../../shared/ui/Feedback';
import { useAdminOrg, useAdminSite } from '../admin/admin';
import { useAlarms } from '../alarms/alarms';
import { ackAlarm, errText } from '../alarms/ackAlarm';
import { prodApi, type DtEvent } from '../production/api';
import { visionApi } from '../vision/api';
import { localName, fmtDuration } from '../production/names';
import type { Alarm } from '../../types';
import '../production/i18n';
import '../alarms/i18n';
import './i18n';

interface ReviewItem {
  id: string; camera: string; fired_at: string;
  detail: { decision?: string; margin?: number; uncertain?: boolean };
}
interface Work { downtimes: DtEvent[]; reviews: ReviewItem[] }

type Pick = { kind: 'alarm' | 'stop' | 'review'; id: string } | null;

export function MyWorkPage() {
  const { t, i18n } = useTranslation();
  const { orgId, orgRole } = useAdminOrg();
  const { site } = useAdminSite(orgId);
  const operable = canOperate(orgRole ?? 'none');
  const qc = useQueryClient();
  const [sel, setSel] = useState<Pick>(null);

  const work = useQuery({
    queryKey: ['my-work', orgId, site?.id],
    queryFn: () => request<Work>(`/api/v1/orgs/${encodeURIComponent(orgId!)}/sites/${encodeURIComponent(site!.id)}/my-work`),
    enabled: !!orgId && !!site,
    refetchInterval: 10_000,
  });
  const alarms = useAlarms().all.filter((a) => a.state === 'active' || a.state === 'rtn_unack');
  const stops = work.data?.downtimes ?? [];
  const reviews = work.data?.reviews ?? [];
  const done = () => { setSel(null); void qc.invalidateQueries({ queryKey: ['my-work'] }); };

  // a finished item leaves the lists, so a stale selection simply stops matching
  const alarm = sel?.kind === 'alarm' ? alarms.find((a) => String(a.id) === sel.id) : undefined;
  const stop = sel?.kind === 'stop' ? stops.find((s) => s.id === sel.id) : undefined;
  const review = sel?.kind === 'review' ? reviews.find((r) => r.id === sel.id) : undefined;
  const picked = alarm ?? stop ?? review;
  const total = alarms.length + stops.length + reviews.length;

  const row = (kind: 'alarm' | 'stop' | 'review', id: string, title: string, sub: string, tone: string) => (
    <li key={`${kind}:${id}`}>
      <button type="button" aria-pressed={sel?.kind === kind && sel.id === id}
        onClick={() => setSel({ kind, id })}
        className={`flex w-full items-center gap-2 rounded-[5px] border p-3 text-left ${
          sel?.kind === kind && sel.id === id ? 'border-ink bg-subtle' : 'border-line bg-paper'}`}>
        <span className={`size-2 shrink-0 rounded-full ${tone}`} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{title}</span>
          <span className="block truncate text-[11px] text-ink-46">{sub}</span>
        </span>
      </button>
    </li>
  );
  const group = (label: string, n: number, items: React.ReactNode) => n > 0 && (
    <section className="mb-4">
      <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[1px] text-ink-46">{label} · {n}</h2>
      <ul className="space-y-1.5">{items}</ul>
    </section>
  );

  return (
    <div className="flex min-h-[calc(100svh-var(--h-topbar))] flex-col">
      <PageBar icon="check" title={t('mw.title')} lede={t('mw.lede')}
        actions={total > 0 ? <span className="text-[12px] text-ink-68">{t('mw.count', { n: total })}</span> : undefined} />
      <PageBody>
        {!operable && <PermissionNotice role="operator">{t('mw.needOperator')}</PermissionNotice>}
        {work.error && <ErrorState detail={t('mw.loadErr')} onRetry={() => void work.refetch()} />}
        {work.isLoading && <SkeletonRows rows={5} h={56} />}
        {!work.isLoading && !work.error && total === 0 && (
          <EmptyState icon="check" title={t('mw.empty')} body={t('mw.emptyBody')} />
        )}
        {total > 0 && (
          <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div className={picked ? 'hidden md:block' : ''}>
              {group(t('mw.alarms'), alarms.length, alarms.map((a) =>
                row('alarm', String(a.id), a.rule, `${a.tag} · ${fmtAge(a.ts)}`,
                  a.severity === 'critical' ? 'bg-[var(--color-danger)]' : 'bg-[var(--color-caution)]')))}
              {group(t('mw.stops'), stops.length, stops.map((s) =>
                row('stop', s.id, localName(s.device, i18n.language) || s.device_id,
                  `${fmtDuration(s.seconds, i18n.language)} · ${fmtAge(s.starts_at)}`, 'bg-[var(--color-caution)]')))}
              {group(t('mw.reviews'), reviews.length, reviews.map((r) =>
                row('review', r.id, `${r.camera} · ${r.detail.decision ?? '—'}`,
                  `${r.detail.uncertain ? t('mw.uncertain') + ' · ' : ''}${fmtAge(r.fired_at)}`,
                  r.detail.uncertain ? 'bg-[var(--color-caution)]' : 'bg-[var(--color-ok)]')))}
            </div>
            <div className={picked ? '' : 'hidden md:block'}>
              {!picked && <EmptyState compact title={t('mw.pick')} body={t('mw.pickBody')} />}
              {picked && (
                <div className="rounded-[5px] border border-line bg-paper p-4 shadow-card">
                  <button type="button" className="btn btn-sm btn-ghost mb-3 md:hidden" onClick={() => setSel(null)}>
                    {t('mw.back')}
                  </button>
                  {alarm && <AlarmPanel alarm={alarm} operable={operable} />}
                  {stop && <StopPanel key={stop.id} orgId={orgId!} siteId={site!.id} ev={stop} operable={operable} onDone={done} />}
                  {review && <ReviewPanel key={review.id} orgId={orgId!} r={review} operable={operable} onDone={done} />}
                </div>
              )}
            </div>
          </div>
        )}
      </PageBody>
    </div>
  );
}

function Err({ show, children }: { show: boolean; children: string }) {
  return show ? <p className="mt-2 text-[12px] text-[var(--color-danger)]" role="alert">{children}</p> : null;
}

function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
      {rows.map(([k, v]) => (<Fragment key={k}><dt className="text-ink-46">{k}</dt><dd className="tabular-nums">{v}</dd></Fragment>))}
    </dl>
  );
}

function AlarmPanel({ alarm, operable }: { alarm: Alarm; operable: boolean }) {
  const { t } = useTranslation();
  // the ack updates the live store, which drops the row from the list by itself
  const ack = useMutation({ mutationFn: () => ackAlarm(alarm) });
  return (
    <>
      <h3 className="mb-2 text-[15px] font-semibold">{alarm.rule}</h3>
      <Facts rows={[[t('mw.severity'), alarm.severity], [t('mw.state'), alarm.state], ['Tag', alarm.tag], [t('mw.raised'), fmtDateTime(alarm.ts)]]} />
      <div className="flex gap-2">
        {operable && (
          <button type="button" className="btn btn-sm" disabled={ack.isPending} onClick={() => ack.mutate()}>
            {ack.isPending ? t('mw.acking') : t('mw.ack')}
          </button>
        )}
        <Link className="btn btn-sm btn-ghost" to={`/alarms/${encodeURIComponent(String(alarm.id))}`}>{t('mw.openAlarm')}</Link>
      </div>
      <Err show={ack.isError}>{ack.error ? errText(ack.error, t) : ''}</Err>
    </>
  );
}

function StopPanel({ orgId, siteId, ev, operable, onDone }: {
  orgId: string; siteId: string; ev: DtEvent; operable: boolean; onDone: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [reasonId, setReasonId] = useState('');
  const [note, setNote] = useState('');
  const reasons = useQuery({ queryKey: ['prod-reasons', orgId], queryFn: () => prodApi.reasons(orgId) });
  const items = (reasons.data?.items ?? []).filter((r) => r.enabled);
  const save = useMutation({
    mutationFn: () => prodApi.classify(orgId, siteId, ev.id, { reason_id: reasonId || null, note: note.trim() || undefined }),
    onSuccess: onDone,
  });
  return (
    <>
      <h3 className="mb-2 text-[15px] font-semibold">{localName(ev.device, i18n.language) || ev.device_id}</h3>
      <Facts rows={[[t('mw.stopped'), fmtDateTime(ev.starts_at)], [t('mw.duration'), fmtDuration(ev.seconds, i18n.language)]]} />
      {operable && (
        <>
          <label className="block text-[12px] font-semibold text-ink-68" htmlFor="mw-reason">{t('mw.reason')}</label>
          <select id="mw-reason" className="input mt-1 w-full" value={reasonId} onChange={(e) => setReasonId(e.target.value)}>
            <option value="">{t('mw.pickReason')}</option>
            {items.map((r) => (
              <option key={r.id} value={r.id}>
                {r.parent_id ? '— ' : ''}{i18n.language === 'th' && r.name_th ? r.name_th : r.name_en}
              </option>
            ))}
          </select>
          <label className="mt-2 block text-[12px] font-semibold text-ink-68" htmlFor="mw-note">{t('mw.note')}</label>
          <textarea id="mw-note" className="input mt-1 w-full" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          <Err show={save.isError}>{t('mw.saveErr')}</Err>
          <div className="mt-2 flex justify-end">
            <button type="button" className="btn btn-sm" disabled={save.isPending || (!reasonId && !note.trim())}
              onClick={() => save.mutate()}>{save.isPending ? t('mw.saving') : t('mw.save')}</button>
          </div>
        </>
      )}
    </>
  );
}

function ReviewPanel({ orgId, r, operable, onDone }: {
  orgId: string; r: ReviewItem; operable: boolean; onDone: () => void;
}) {
  const { t } = useTranslation();
  const send = useMutation({
    mutationFn: (verdict: 'correct' | 'wrong') => visionApi.review(orgId, r.id, { verdict }),
    onSuccess: onDone,
  });
  const d = r.detail;
  return (
    <>
      <h3 className="mb-2 text-[15px] font-semibold">{d.decision ?? '—'}</h3>
      <Facts rows={[
        [t('mw.camera'), r.camera], [t('mw.raised'), fmtDateTime(r.fired_at)],
        [t('mw.margin'), typeof d.margin === 'number' ? `${Math.round(d.margin * 100)}%` : '—'],
        ...(d.uncertain ? [[t('mw.uncertain'), '!'] as [string, string]] : []),
      ]} />
      {operable && (
        <div className="flex gap-2">
          <button type="button" className="btn btn-sm" disabled={send.isPending} onClick={() => send.mutate('correct')}>{t('mw.correct')}</button>
          <button type="button" className="btn btn-sm btn-ghost" disabled={send.isPending} onClick={() => send.mutate('wrong')}>{t('mw.wrong')}</button>
        </div>
      )}
      <Err show={send.isError}>{t('mw.reviewErr')}</Err>
    </>
  );
}
