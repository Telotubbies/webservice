// Alarm detail — the operator's response page: who owns it (ack strip with
// the primary action), lifecycle with who/when, value now (stale/quality
// honest), trend since the alarm was raised with the rule limit, the rule,
// pivots to line/tags/trends and earlier alarms on the same signal.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { live, STALE_MS } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { SIGNALS, equipmentOf } from '../../lib/plant';
import { fmtAge, fmtDuration } from '../../lib/format';
import { canOperate, useRole } from '../../app/session';
import { useAdminOrg } from '../admin/admin';
import { AlarmActions } from './AlarmActions';
import { useAlarms } from './alarms';
import { StandardChart } from '../charts/StandardChart';
import type { Limit } from '../trends/viz';
import type { Annotation } from '../../viz/annotations';
import { AlarmStateChip } from './AlarmStateChip';
import { ShelveDialog } from './ShelveDialog';
import { shelfApi } from './shelfApi';
import { notifyApi } from '../notify/api';
import { needsAck, isShelved } from './alarms';
import { ackAlarm, errText } from './ackAlarm';
import { useSiteAlarms } from './siteAlarms';
import './i18n';
import { SeverityBadge, QualityMark } from '../../shared/ui/Status';
import { Card } from '../../shared/ui/Page';
import { EmptyState, ErrorState, Skeleton } from '../../shared/ui/Feedback';
import { Icon } from '../../shared/ui/Icon';
import { DdIcon } from '../../shared/ui/DdIcon';

export function AlarmDetailPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const now = useNow();
  const role = useRole();
  const { orgId, orgRole } = useAdminOrg();
  const operable = canOperate(role) || canOperate(orgRole ?? 'none');
  const { all } = useAlarms();
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shelving, setShelving] = useState(false);
  const qc = useQueryClient();
  useStore(() => live.version); // re-render on live value updates
  useStore(() => live.seedRev); // re-render when the alarm seed lands or fails
  const rules = useQuery({ queryKey: ['alarm-rules'], queryFn: api.alarmRules, staleTime: 60_000 });
  // v1 alarms carry acked_by but not acked_at / cleared_at — enrich from v2
  const site = useSiteAlarms({ refetchMs: 30_000 });

  const alarm = useMemo(() => {
    const a = all.find((x) => String(x.id) === id);
    if (!a) return undefined;
    const v2 = site.data?.find((x) => x.id === String(a.id));
    return v2 ? {
      ...a,
      acked_at: a.acked_at ?? v2.acked_at,
      acked_by: a.acked_by ?? v2.acked_by,
      cleared_at: a.cleared_at ?? v2.cleared_at,
      shelved_until: a.shelved_until ?? v2.shelved_until,
      assigned_to: a.assigned_to ?? v2.assigned_to,
      assigned_name: a.assigned_name ?? v2.assigned_name,
    } : a;
  }, [all, id, site.data]);
  const shelf = useQuery({ queryKey: ['alarm-shelf', orgId], queryFn: () => shelfApi.list(orgId!), enabled: !!orgId, refetchInterval: 30_000, staleTime: 0, refetchOnMount: 'always' });
  const unshelve = useMutation({
    mutationFn: () => notifyApi.unshelve(orgId!, String(id)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['alarm-shelf', orgId] });
      void qc.invalidateQueries({ queryKey: ['alarm-events', orgId, String(id)] });
      void qc.invalidateQueries({ queryKey: ['site-alarms'] });
    },
    onError: () => setErr(t('shelve.errUnshelve')),
  });
  const meta = alarm ? SIGNALS[alarm.tag] : undefined;
  const tv = alarm ? live.latest.get(alarm.tag) : undefined;

  if (!alarm) {
    return (
      <div className="p-4">
        <p className="mb-3 text-[13px]"><NavLink to="/alarms" className="rounded text-blue hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue">‹ {t('alarms.title')}</NavLink></p>
        {live.seedError && !live.alarmsSeeded ? (
          <ErrorState onRetry={() => window.location.reload()} />
        ) : !live.alarmsSeeded ? (
          <Card pad={false}>
            <div className="space-y-2 p-3">
              {[28, 20, 28].map((h, i) => <Skeleton key={i} h={h} />)}
            </div>
          </Card>
        ) : (
          <Card><EmptyState title={t('alarms.detail.notFound')} body={t('alarms.emptyFilteredBody')} /></Card>
        )}
      </div>
    );
  }

  const stale = !!tv && now - Date.parse(tv.ts) > STALE_MS;
  const eq = equipmentOf(alarm.tag);
  const unit = meta?.unit ?? '';
  const fmtV = (v: number) => `${v.toFixed(meta?.decimals ?? 1)}${unit ? ` ${unit}` : ''}`;
  const raisedMs = Date.parse(alarm.ts);
  const endMs = alarm.cleared_at ? Date.parse(alarm.cleared_at) : now;
  // alarm.rule keeps the rule name as it was when the alarm was raised —
  // exact match first, then a name-prefix match for renamed rules or a stored
  // string that carries the condition ("name > 75").
  const rule = rules.data?.find((r) => r.name === alarm.rule && (!r.tag || r.tag === alarm.tag))
    ?? rules.data?.find((r) => r.name === alarm.rule)
    ?? rules.data?.find((r) => alarm.rule.startsWith(`${r.name} `) && (!r.tag || r.tag === alarm.tag));
  const guide = rule as (typeof rule & { cause?: string; consequence?: string; steps?: string[]; respond_within_min?: number }) | undefined;
  const hasGuide = !!(guide?.cause || guide?.consequence || guide?.steps?.length);
  const open = needsAck(alarm);
  const shelvedNow = isShelved(alarm, now);
  const shelfRow = shelf.data?.items.find((r) => r.id === String(alarm.id));
  // the respond-within clock only matters while nobody has acknowledged
  const dueMs = guide?.respond_within_min ? raisedMs + guide.respond_within_min * 60_000 : null;
  const dueLeftMin = dueMs != null ? Math.ceil((dueMs - now) / 60_000) : null;

  // the window the chart shows, carried to Trends so it opens on this alarm
  const chartFrom = Math.max(raisedMs - 20 * 60_000, now - 8 * 3600_000);
  const trendsHref = `/trends?tags=${encodeURIComponent(alarm.tag)}&from=${Math.round(chartFrom)}&to=${Math.round(Math.max(endMs + 5 * 60_000, chartFrom + 60_000))}`;
  const limits: Limit[] = rule && rule.threshold != null && rule.kind !== 'stale'
    ? [{ v: rule.threshold, kind: rule.kind, severity: rule.severity === 'critical' ? 'critical' : 'warning' }] : [];
  const events: Annotation[] = [{ t: raisedMs, kind: 'alarm', label: t('alx.trendRaised'), severity: alarm.severity === 'critical' ? 'critical' : 'warning' }];

  // other alarms around the same time, any signal: what else was going on
  const around = all.filter((a) => String(a.id) !== String(alarm.id) && Math.abs(Date.parse(a.ts) - raisedMs) <= 30 * 60_000).slice(0, 6);
  const sameRule = all.filter((a) => a.rule === alarm.rule);
  const ackTimes = sameRule.filter((a) => a.acked_at).map((a) => Date.parse(a.acked_at!) - Date.parse(a.ts)).filter((x) => x >= 0).sort((x, y) => x - y);
  const medianAck = ackTimes.length ? ackTimes[Math.floor(ackTimes.length / 2)] : null;
  const earlier = all.filter((a) => a.tag === alarm.tag && String(a.id) !== String(alarm.id)).slice(0, 5);

  const doAck = () => {
    setBusy(true);
    setErr('');
    ackAlarm(alarm)
      .catch((e) => setErr(t('alx.ackFailed', { reason: errText(e, t) })))
      .finally(() => setBusy(false));
  };
  const copyLink = () => {
    void navigator.clipboard?.writeText(`${window.location.origin}/alarms/${encodeURIComponent(String(alarm.id))}`)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })
      .catch(() => {});
  };
  const clock = (iso: string) => new Date(iso).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit', hour12: false });
  const span = (ms: number) => fmtDuration(new Date(0).toISOString(), ms);

  const sideTitle = 'mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-46';
  const link = 'rounded text-blue hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue';
  const stateLine = alarm.state === 'active' ? t('alx.ackStatusActive')
    : alarm.state === 'rtn_unack' ? t('alx.ackStatusRtn')
      : alarm.state === 'acked' ? t('alx.ackStatusAcked', { who: alarm.acked_by ?? t('alx.ackedUnknownWho') })
        : t('alx.ackStatusCleared');

  return (
    <>
      <div className="sticky top-[var(--h-topbar)] z-10 border-b border-line bg-paper/95 backdrop-blur">
        <div className="flex h-11 items-center gap-1.5 px-4 text-[13px]">
          <DdIcon name="assert-list" size={13} className="text-ink-46" />
          <NavLink to="/alarms" className="shrink-0 rounded text-ink-68 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue">{t('alarms.title')}</NavLink>
          <span className="text-ink-35" aria-hidden>›</span>
          <span className="min-w-0 truncate font-medium">{alarm.rule}</span>
          <span className="flex-1" />
          <button type="button" className="btn btn-sm btn-ghost shrink-0 max-md:min-h-11" onClick={copyLink} aria-live="polite">
            {copied ? t('alx.linkCopied') : t('alx.copyLink')}
          </button>
        </div>
      </div>

      <div className="p-4">
        {/* what it is, how bad, who has it, and the actions: one block */}
        <div className="mb-3 flex flex-wrap items-start gap-x-4 gap-y-3">
          <div className="min-w-0 flex-1 basis-72">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <SeverityBadge severity={alarm.severity} />
              <AlarmStateChip state={alarm.state} ackedBy={alarm.acked_by} />
              {(alarm as { late?: boolean }).late && <span className="rounded-full bg-subtle px-1.5 py-0.5 text-[10px] font-medium text-ink-68">{t('alx.late')}</span>}
              {shelvedNow && <span className="rounded-full bg-subtle px-1.5 py-0.5 text-[10px] font-medium text-ink-68">{t('shelve.mark')}</span>}
            </div>
            <h1 className="text-[22px] font-semibold leading-7">{alarm.rule}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px] text-ink-68">
              {meta && <span className="font-medium text-ink">{t(meta.labelKey)}</span>}
              <span className="font-mono text-ink-46">{alarm.tag}</span>
              {eq && <span>· {t(`line.${eq}`)}</span>}
            </p>
            <p className="mt-1 text-[13px] text-ink">{stateLine}</p>
            <p className="mt-0.5 text-[12px] text-ink-68">
              {t('alx.raisedAgo', { age: fmtAge(alarm.ts, now) })}
              {' · '}
              <time className="font-mono tabular-nums" dateTime={alarm.ts}>
                {new Date(alarm.ts).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'medium', hour12: false })}
              </time>
              {alarm.state !== 'cleared' && <> · <span className="tabular-nums">{fmtDuration(alarm.ts, now)}</span></>}
            </p>
            {alarm.state === 'active' && dueLeftMin != null && (
              <p className={`mt-1 text-[12px] font-semibold ${dueLeftMin < 0 ? 'text-[var(--color-danger)]' : 'text-ink'}`} data-testid="respond-due">
                {dueLeftMin < 0 ? `▲ ${t('alx.respondOver', { min: -dueLeftMin })}` : t('alx.respondLeft', { min: dueLeftMin })}
              </p>
            )}
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">
            {operable && open && (
              <button type="button" className="btn btn-ack min-h-11 flex-1 justify-center md:flex-none" disabled={busy} onClick={doAck}>
                <Icon name="check" size={14} /> {busy ? t('alx.ackBusy') : t('alarms.ack')}
              </button>
            )}
            {operable && alarm.state !== 'cleared' && !shelvedNow && orgId && (
              <button type="button" className="btn btn-ghost min-h-11 flex-1 justify-center md:flex-none" onClick={() => setShelving(true)}>{t('shelve.open')}</button>
            )}
            {operable && (
              <a href="#al-assignee" className="btn btn-ghost min-h-11 flex-1 justify-center md:flex-none">{t('al.assign')}</a>
            )}
            <Link to="/live" className="btn btn-ghost min-h-11 flex-1 justify-center md:flex-none" data-testid="pivot-live">{t('alx.openLive')}</Link>
          </div>
          {!operable && open && <p className="basis-full text-[12px] text-ink-68">{t('alx.viewOnly')}</p>}
          {err && <p className="basis-full text-[12px] text-[var(--color-danger)]" role="alert">{err}</p>}
        </div>

        {shelvedNow && (
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[5px] border border-line bg-subtle px-3 py-2 text-[13px]" role="status" data-testid="shelf-banner">
            <p className="min-w-0 flex-1">
              <span className="font-semibold">{t('shelve.bannerTitle', { at: new Date(alarm.shelved_until!).toLocaleString(i18n.language, { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short', hour12: false }) })}</span>
              {' '}
              {shelfRow ? t('shelve.bannerBy', { who: shelfRow.shelved_by ?? t('shelve.unknownWho'), why: shelfRow.reason || t('shelve.noReason') }) : null}
            </p>
            {operable && <button type="button" className="btn btn-sm min-h-11 md:min-h-8" disabled={unshelve.isPending} onClick={() => unshelve.mutate()}>{t('shelve.unshelve')}</button>}
          </div>
        )}

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-3">
            <Card title={t('alx.trend')}>
              <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                {tv ? (
                  <>
                    <span className="text-[11px] text-ink-46">{t('alx.valueNow')}</span>
                    <span className={`font-mono text-[28px] font-semibold leading-none tabular-nums ${stale || tv.q !== 'good' ? 'text-ink-46' : 'text-ink'}`}>
                      {typeof tv.v === 'number' ? tv.v.toFixed(meta?.decimals ?? 1) : String(tv.v)}
                    </span>
                    {unit && <span className="text-[13px] text-ink-46">{unit}</span>}
                    <QualityMark q={tv.q} stale={stale} />
                    <span className="ml-auto text-[11px] text-ink-46">{t('alx.valueAt', { age: fmtAge(tv.ts, now) })}</span>
                    {stale && <span className="basis-full text-[12px] text-ink-68">{t('alx.valueStale', { age: fmtAge(tv.ts, now) })}</span>}
                  </>
                ) : <span className="text-[13px] text-ink-68">{t('alx.valueNone')}</span>}
              </div>
              <StandardChart
                tag={alarm.tag} label={meta ? t(meta.labelKey) : alarm.tag} unit={unit} decimals={meta?.decimals ?? 1}
                range={[chartFrom, Math.max(now, chartFrom + 60_000)]} limits={limits} events={events} height={220}
              />
              <p className="mt-2 text-[12px]">
                <Link to={trendsHref} className={link} data-testid="pivot-trends">{t('alx.openInTrends')}</Link>
              </p>
            </Card>

            <Card title={t('alx.around')}>
              {around.length === 0 ? <p className="text-[12px] text-ink-46">{t('alx.aroundNone')}</p> : (
                <ul className="space-y-1">
                  {around.map((r) => (
                    <li key={r.id}>
                      <Link to={`/alarms/${r.id}`} className="flex items-center gap-2 rounded px-1 py-1.5 text-[12px] hover:bg-subtle focus-visible:outline-2 focus-visible:outline-blue">
                        <span className="w-12 shrink-0 font-mono text-ink-46">{clock(r.ts)}</span>
                        <SeverityBadge severity={r.severity} />
                        <span className="min-w-0 flex-1 truncate">{r.rule}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title={t('alx.history')}>
              <div className="grid grid-cols-3 gap-2">
                <div><div className="font-mono text-[20px] tabular-nums">{sameRule.length}</div><div className="text-[12px] text-ink-68">{t('alx.occurrences')}</div></div>
                <div><div className="font-mono text-[20px] tabular-nums">{medianAck != null ? span(medianAck) : '—'}</div><div className="text-[12px] text-ink-68">{t('alx.medianAck')}</div></div>
                <div><div className="font-mono text-[20px] tabular-nums">{earlier.length}</div><div className="text-[12px] text-ink-68">{t('alx.related')}</div></div>
              </div>
              {earlier.length > 0 && (
                <ul className="mt-2 space-y-1 border-t border-line pt-2">
                  {earlier.map((r) => (
                    <li key={r.id}>
                      <Link to={`/alarms/${r.id}`} className="flex items-center gap-2 rounded px-1 py-1 text-[12px] hover:bg-subtle focus-visible:outline-2 focus-visible:outline-blue">
                        <SeverityBadge severity={r.severity} />
                        <span className="min-w-0 flex-1 truncate">{r.rule}</span>
                        <span className="shrink-0 text-ink-46">{fmtAge(r.ts, now)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-[11px] text-ink-46">{t('alx.historyNote')}</p>
            </Card>
          </div>

          <aside className="min-w-0 space-y-3">
            <Card title={t('alx.todo')}>
              {hasGuide ? (
                <div className="space-y-3 text-[13px]">
                  {guide?.respond_within_min != null && <p><b>{t('alx.respondWithin')}</b> <span className="font-mono">{t('alx.min', { count: guide.respond_within_min })}</span></p>}
                  {guide?.cause && <div><b>{t('alx.cause')}</b><p className="text-ink-68">{guide.cause}</p></div>}
                  {guide?.consequence && <div><b>{t('alx.consequence')}</b><p className="text-ink-68">{guide.consequence}</p></div>}
                  {!!guide?.steps?.length && <div><b>{t('alx.steps')}</b><ol className="mt-1 list-decimal space-y-0.5 pl-5 text-ink-68">{guide.steps.map((x) => <li key={x}>{x}</li>)}</ol></div>}
                </div>
              ) : (
                <p className="text-[13px] text-ink-68">{rules.isPending ? t('common.loading') : t('alx.todoNone')}</p>
              )}
              <p className="mt-2 text-[12px]"><NavLink to="/admin/rules" className={link}>{t('alarms.detail.editRule')}</NavLink></p>
            </Card>

            <Card title={t('alarms.tlTitle')}>
              <ol className="space-y-1.5 text-[13px]" aria-label={t('alarms.tlTitle')}>
                <li className="flex gap-3"><time className="w-12 shrink-0 font-mono text-ink-46">{clock(alarm.ts)}</time><span><b>{t('alarms.tlRaised')}</b></span></li>
                {alarm.cleared_at && (
                  <li className="flex gap-3"><time className="w-12 shrink-0 font-mono text-ink-46">{clock(alarm.cleared_at)}</time><span><b>{t('alx.tlReturned')}</b></span></li>
                )}
                {alarm.acked_at ? (
                  <li className="flex gap-3"><time className="w-12 shrink-0 font-mono text-ink-46">{clock(alarm.acked_at)}</time><span><b>{t('alarms.tlAcked')}</b>{alarm.acked_by ? ` · ${alarm.acked_by}` : ''}</span></li>
                ) : open ? (
                  <li className="flex gap-3 text-ink-68"><span className="w-12 shrink-0 font-mono text-ink-35">…</span><span>{t('alx.waitingAck')}</span></li>
                ) : null}
                {(alarm.state === 'active' || alarm.state === 'acked') && (
                  <li className="flex gap-3 text-ink-68"><span className="w-12 shrink-0 font-mono text-ink-35">…</span><span>{rule?.threshold != null ? t('alx.tlWillReturn', { v: fmtV(rule.threshold) }) : t('alx.tlWillReturnPlain')}</span></li>
                )}
              </ol>
            </Card>

            <Card>
              <p className={sideTitle}>{t('alx.ruleTitle')}</p>
              {rule ? (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
                  <dt className="text-ink-46">{t('alx.ruleKind.' + rule.kind)}</dt>
                  <dd className="font-mono tabular-nums">{rule.kind === 'stale' ? `${rule.stale_s ?? '—'} s` : rule.threshold != null ? fmtV(rule.threshold) : '—'}</dd>
                  {rule.kind !== 'stale' && <><dt className="text-ink-46">{t('alx.ruleDeadband')}</dt><dd className="font-mono tabular-nums">{rule.deadband}</dd></>}
                  <dt className="text-ink-46">{t('alx.ruleSeverity')}</dt>
                  <dd><SeverityBadge severity={rule.severity} /></dd>
                </dl>
              ) : (
                <p className="text-[12px] text-ink-46">{rules.isPending ? t('common.loading') : t('alx.ruleUnknown')}</p>
              )}
            </Card>

            <Card>
              <p className={sideTitle}>{t('alx.pivots')}</p>
              <div className="grid gap-1.5">
                <Link to="/live" className="btn btn-sm btn-ghost min-h-11 w-full justify-start md:min-h-8"><Icon name="line" size={13} /> {t('alx.pivotLine')}</Link>
                <Link to={`/tags?q=${encodeURIComponent(alarm.tag)}`} className="btn btn-sm btn-ghost min-h-11 w-full justify-start md:min-h-8"><Icon name="search" size={13} /> {t('alx.pivotTags')}</Link>
                <Link to={trendsHref} className="btn btn-sm btn-ghost min-h-11 w-full justify-start md:min-h-8"><Icon name="activity" size={13} /> {t('alx.pivotTrends')}</Link>
              </div>
            </Card>

            <AlarmActions alarm={alarm} orgId={orgId} operable={operable} />
          </aside>
        </div>
        <p className="mt-3 text-[12px]">
          <NavLink to="/alarms" className={link}>‹ {t('alx.backToList')}</NavLink>
        </p>
      </div>
      {shelving && orgId && <ShelveDialog alarm={alarm} orgId={orgId} onClose={() => setShelving(false)} />}
    </>
  );
}
