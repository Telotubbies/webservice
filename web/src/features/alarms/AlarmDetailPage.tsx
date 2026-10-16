// Alarm detail — the operator's response page: who owns it (ack strip with
// the primary action), lifecycle with who/when, value now (stale/quality
// honest), trend since the alarm was raised with the rule limit, the rule,
// pivots to line/tags/trends and earlier alarms on the same signal.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { live, STALE_MS } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { SIGNALS, equipmentOf } from '../../lib/plant';
import { fmtAge, fmtDuration } from '../../lib/format';
import { canOperate, useRole } from '../../app/session';
import { useAdminOrg } from '../admin/admin';
import { AlarmActions } from './AlarmActions';
import { useAlarms } from './alarms';
import { AlarmLifecycle } from './AlarmLifecycle';
import { AlarmTrend } from './AlarmTrend';
import { ackAlarm, errText } from './ackAlarm';
import { useSiteAlarms } from './siteAlarms';
import './i18n';
import { SeverityBadge, AlarmStateBadge, QualityMark } from '../../shared/ui/Status';
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
  const related = all.filter((a) => a.tag === alarm.tag && String(a.id) !== String(alarm.id)).slice(0, 5);
  const rule = rules.data?.find((r) => r.name === alarm.rule && (!r.tag || r.tag === alarm.tag))
    ?? rules.data?.find((r) => r.name === alarm.rule);
  const unit = meta?.unit ?? '';
  const fmtV = (v: number) => `${v.toFixed(meta?.decimals ?? 1)}${unit ? ` ${unit}` : ''}`;

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

  const ackBtn = alarm.state === 'active' && operable && (
    <button type="button" className="btn btn-ack shrink-0" disabled={busy} onClick={doAck}>
      <Icon name="check" size={14} /> {busy ? t('alx.ackBusy') : t('alarms.ack')}
    </button>
  );

  // ownership strip — colour + glyph + text; the one place that answers
  // "is someone on this?" for the alarm
  const strip = alarm.state === 'active'
    ? { cls: 'border-[var(--color-danger-bright)] bg-[var(--color-danger-soft)]', glyph: '▲', text: t('alx.ackStatusActive') }
    : alarm.state === 'acked'
      ? { cls: 'border-[var(--color-caution)] bg-[var(--color-caution-soft)]', glyph: '✓', text: t('alx.ackStatusAcked', { who: alarm.acked_by ?? t('alx.ackedUnknownWho') }) }
      : { cls: 'border-line bg-subtle', glyph: '●', text: t('alx.ackStatusCleared') };

  const sideTitle = 'mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-46';

  return (
    <>
      {/* breadcrumb bar — dd monitor status: "Monitors > Status" */}
      <div className="sticky top-9 z-10 border-b border-line bg-white/95 backdrop-blur">
        <div className="flex h-11 items-center gap-1.5 px-4 text-[13px]">
          <DdIcon name="assert-list" size={13} className="text-ink-46" />
          <NavLink to="/alarms" className="shrink-0 rounded text-ink-68 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue">{t('alarms.title')}</NavLink>
          <span className="text-ink-35" aria-hidden>›</span>
          <span className="min-w-0 truncate font-medium">{alarm.rule}</span>
          <span className="flex-1" />
          <button type="button" className="btn btn-sm btn-ghost shrink-0" onClick={copyLink} aria-live="polite">
            {copied ? t('alx.linkCopied') : t('alx.copyLink')}
          </button>
        </div>
      </div>

      <div className="p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <SeverityBadge severity={alarm.severity} />
          <AlarmStateBadge state={alarm.state} ackedBy={alarm.acked_by} />
        </div>
        <h1 className="mb-1 text-[22px] font-semibold leading-7">{alarm.rule}</h1>
        <p className="mb-3 flex flex-wrap items-center gap-x-2 text-[12px] text-ink-68">
          {meta && <span className="font-medium text-ink">{t(meta.labelKey)}</span>}
          <span className="font-mono text-ink-46">{alarm.tag}</span>
          {eq && <span>· {t(`line.${eq}`)}</span>}
        </p>

        {/* ownership + timing strip with the primary action */}
        <div className={`mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[5px] border-l-4 px-3 py-2 ${strip.cls}`}>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[14px] font-semibold text-ink">
              <span aria-hidden className="text-[11px]">{strip.glyph}</span>{strip.text}
            </p>
            <p className="mt-0.5 text-[12px] text-ink-68">
              {t('alx.raisedAgo', { age: fmtAge(alarm.ts, now) })}
              {' · '}
              <time className="font-mono tabular-nums" dateTime={alarm.ts}>
                {new Date(alarm.ts).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'medium', hour12: false })}
              </time>
              {alarm.state !== 'cleared' && <> · <span className="font-mono tabular-nums">{fmtDuration(alarm.ts, now)}</span></>}
            </p>
          </div>
          {ackBtn}
          {alarm.state === 'active' && !operable && <span className="text-[12px] text-ink-68">{t('alx.viewOnly')}</span>}
          {err && <p className="basis-full text-[12px] text-[var(--color-danger)]" role="alert">{err}</p>}
        </div>

        <Card>
          <AlarmLifecycle alarm={alarm} now={now} />
        </Card>

        {/* §3.5 lifecycle: shelve / assign / comments + §3.4 mobile ack link */}
        <div className="mt-3">
          <AlarmActions alarm={alarm} orgId={orgId} operable={operable} />
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_288px]">
          <div className="min-w-0 space-y-3">
            <Card title={t('alx.valueNow')}>
              {tv ? (
                <>
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className={`font-mono text-[34px] font-semibold leading-none tabular-nums ${stale || tv.q !== 'good' ? 'text-ink-46' : 'text-ink'}`}>
                      {typeof tv.v === 'number' ? tv.v.toFixed(meta?.decimals ?? 1) : String(tv.v)}
                    </span>
                    {unit && <span className="text-[14px] text-ink-46">{unit}</span>}
                    <QualityMark q={tv.q} stale={stale} />
                    <span className="ml-auto text-[11px] text-ink-46">{t('alx.valueAt', { age: fmtAge(tv.ts, now) })}</span>
                  </div>
                  {stale && <p className="mt-2 text-[12px] text-ink-68">{t('alx.valueStale', { age: fmtAge(tv.ts, now) })}</p>}
                  {rule?.threshold != null && rule.kind !== 'stale' && (
                    <p className="mt-2 text-[12px] text-ink-68">
                      {t(`alx.ruleKind.${rule.kind}`)}: <span className="font-mono tabular-nums">{fmtV(rule.threshold)}</span>
                    </p>
                  )}
                </>
              ) : (
                <p className="text-[13px] text-ink-68">{t('alx.valueNone')}</p>
              )}
            </Card>
            <Card title={t('alx.trend')}>
              <AlarmTrend
                tag={alarm.tag}
                raisedAt={alarm.ts}
                limit={rule?.kind !== 'stale' ? rule?.threshold : null}
                unit={unit}
                decimals={meta?.decimals ?? 1}
                severity={alarm.severity}
              />
            </Card>
          </div>

          <aside className="space-y-3">
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
              <p className="mt-2 text-[12px]">
                <NavLink to="/admin/rules" className="rounded text-blue hover:underline focus-visible:outline-2 focus-visible:outline-blue">{t('alarms.detail.editRule')}</NavLink>
              </p>
            </Card>
            <Card>
              <p className={sideTitle}>{t('alx.pivots')}</p>
              <div className="grid gap-1.5">
                <Link to={eq ? `/line?eq=${encodeURIComponent(eq)}` : '/line'} className="btn btn-sm btn-ghost w-full justify-start"><Icon name="line" size={13} /> {t('alx.pivotLine')}</Link>
                <Link to={`/tags?q=${encodeURIComponent(alarm.tag)}`} className="btn btn-sm btn-ghost w-full justify-start"><Icon name="search" size={13} /> {t('alx.pivotTags')}</Link>
                <Link to="/trends" className="btn btn-sm btn-ghost w-full justify-start"><Icon name="activity" size={13} /> {t('alx.pivotTrends')}</Link>
              </div>
            </Card>
            <Card>
              <p className={sideTitle}>{t('alx.related')}</p>
              {related.length === 0 ? (
                <p className="text-[12px] text-ink-46">{t('alx.relatedNone')}</p>
              ) : (
                <ul className="space-y-1">
                  {related.map((r) => (
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
            </Card>
          </aside>
        </div>
        <p className="mt-3 text-[12px]">
          <NavLink to="/alarms" className="rounded text-blue hover:underline focus-visible:outline-2 focus-visible:outline-blue">‹ {t('alx.backToList')}</NavLink>
        </p>
      </div>
    </>
  );
}
