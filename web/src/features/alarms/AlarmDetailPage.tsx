// Alarm detail — dd monitor-status page pattern: breadcrumb, status pill row,
// title, scope chips + time context, Evaluated/Source/Transitions tabs,
// right rail with rule (query) + message template + next steps.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, useParams } from 'react-router';
import { api } from '../../lib/api';
import { live } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { SIGNALS } from '../../lib/plant';
import { fmtAge, fmtDuration } from '../../lib/format';
import { canOperate, useRole } from '../../app/session';
import { useAlarms } from './alarms';
import { AlarmLifecycle } from './AlarmLifecycle';
import { SeverityBadge, AlarmStateBadge, normAlarmState, normSeverity } from '../../shared/ui/Status';
import { Card } from '../../shared/ui/Page';
import { EmptyState, ErrorState, Skeleton } from '../../shared/ui/Feedback';
import { Icon } from '../../shared/ui/Icon';
import { DdIcon } from '../../shared/ui/DdIcon';

type DetailTab = 'live' | 'rule' | 'transitions';

function ScopeChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex h-7 items-center gap-1.5 rounded border border-line bg-white px-2 text-[12px]">
      <span className="text-ink-46">{label}</span>
      <span className="font-medium">{value}</span>
    </span>
  );
}

export function AlarmDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const now = useNow();
  const role = useRole();
  const operable = canOperate(role);
  const { all } = useAlarms();
  const [tab, setTab] = useState<DetailTab>('live');
  const [err, setErr] = useState('');
  useStore(() => live.tagRev); // re-render on live value updates
  useStore(() => live.seedRev); // re-render when the alarm seed lands or fails

  const alarm = useMemo(() => all.find((a) => String(a.id) === id), [all, id]);
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

  const transitions = [
    { label: t('alarms.tlRaised'), ts: alarm.ts, done: true },
    { label: t('alarms.tlAcked'), ts: alarm.acked_at, done: !!alarm.acked_at, by: alarm.acked_by },
    { label: t('alarms.tlCleared'), ts: alarm.cleared_at, done: !!alarm.cleared_at },
  ];

  const tabBtn = (v: DetailTab, label: string) => (
    <button
      key={v}
      type="button"
      onClick={() => setTab(v)}
      role="tab"
      aria-selected={tab === v}
      className={`flex h-9 items-center border-b-2 px-3 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue ${
        tab === v ? 'border-blue font-semibold text-ink' : 'border-transparent text-ink-68 hover:text-blue'
      }`}
    >
      {label}
    </button>
  );

  return (
    <>
      {/* breadcrumb bar — dd monitor status: "Monitors > Status" */}
      <div className="sticky top-9 z-10 border-b border-line bg-white/90 backdrop-blur">
        <div className="flex h-11 items-center gap-1.5 px-4 text-[13px]">
          <DdIcon name="assert-list" size={13} className="text-ink-46" />
          <NavLink to="/alarms" className="rounded text-ink-68 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue">{t('alarms.title')}</NavLink>
          <span className="text-ink-35">›</span>
          <span className="font-medium">{alarm.rule}</span>
        </div>
      </div>

      <div className="p-4">
        {/* status pill + scope + actions */}
        <div className="mb-3 flex items-center gap-2">
          <AlarmStateBadge state={alarm.state} ackedBy={alarm.acked_by} />
          <SeverityBadge severity={alarm.severity} />
          <span className="flex-1" />
          <NavLink to={`/tags?q=${encodeURIComponent(alarm.tag)}`} className="btn btn-sm btn-ghost focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue"><Icon name="search" size={12} /> {t('alarms.openFaceplate')}</NavLink>
          {alarm.state === 'active' && operable && (
            <button
              className="flex h-7 items-center gap-1 rounded bg-blue px-2.5 text-[13px] text-white hover:brightness-110"
              onClick={() => {
                void api.ackAlarm(alarm.id)
                  .then(() => live.upsertAlarm({ ...alarm, state: 'acked' }))
                  .catch((e) => setErr(String((e as Error).message ?? e)));
              }}
            >
              <Icon name="check" size={13} /> {t('alarms.ack')}
            </button>
          )}
        </div>
        {err && <p className="mb-2 text-[12px] text-[var(--color-danger)]" role="alert">{err}</p>}

        <h1 className="mb-3 text-[22px] font-semibold leading-7">{alarm.rule}</h1>

        {/* scope chips + time context */}
        <div className="mb-3 flex items-center gap-2">
          <ScopeChip label={t('ctx.tag')} value={alarm.tag} />
          {/* normalise before t() — a raw backend string must not reach the UI */}
          <ScopeChip label={t('alarms.colState')} value={t(`alarms.${normAlarmState(alarm.state)}`)} />
          <ScopeChip label={t('alarms.severity')} value={t(`alarms.${normSeverity(alarm.severity)}`)} />
          <span className="flex-1" />
          <span className="text-[12px] text-ink-46">
            {t('alarms.colRaised')} {fmtAge(alarm.ts, now)} · {fmtDuration(alarm.ts, now)}
          </span>
        </div>

        {/* tabs */}
        <div className="mb-3 flex border-b border-line" role="tablist">
          {tabBtn('live', t('alarms.detail.live'))}
          {tabBtn('rule', t('alarms.detail.rule'))}
          {tabBtn('transitions', t('alarms.detail.transitions'))}
        </div>

        <Card>
          <AlarmLifecycle alarm={alarm} now={now} />
        </Card>

        <div className="flex gap-4">
          {/* main column */}
          <div className="min-w-0 flex-1">
            {tab === 'live' && (
              <Card>
                {tv ? (
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[32px] font-semibold leading-none">{typeof tv.v === 'number' ? tv.v.toFixed(meta?.decimals ?? 1) : String(tv.v)}</span>
                    {meta?.unit && <span className="text-[13px] text-ink-46">{meta.unit}</span>}
                    <span className="ml-auto text-[11px] text-ink-46">{fmtAge(tv.ts, now)}</span>
                  </div>
                ) : (
                  <EmptyState title={t('state.stale')} body={t('state.never')} />
                )}
                {meta && <p className="mt-2 text-[12px] text-ink-68">{t(meta.labelKey)}</p>}
              </Card>
            )}
            {tab === 'rule' && (
              <Card>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-46">{t('alarms.rule')}</p>
                <code className="block rounded bg-subtle p-3 font-mono text-[12px] leading-5">{alarm.rule}</code>
                <p className="mt-3 text-[12px] text-ink-68">
                  <NavLink to="/admin/rules" className="text-blue hover:underline">{t('alarms.detail.editRule')}</NavLink>
                </p>
              </Card>
            )}
            {tab === 'transitions' && (
              <Card pad={false}>
                <ul>
                  {transitions.map((s) => (
                    <li key={s.label} className="flex h-9 items-center gap-3 border-b border-line px-4 last:border-0 text-[13px]">
                      <span className={`h-2 w-2 rounded-full ${s.done ? 'bg-blue' : 'bg-line'}`} />
                      <span className="w-28 font-medium">{s.label}</span>
                      <span className="text-ink-68">{s.ts ? fmtAge(s.ts, now) : t('alarms.tlWaiting')}</span>
                      {'by' in s && s.by ? <span className="text-ink-46">{s.by}</span> : null}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>

          {/* right rail — query + next steps */}
          <aside className="w-72 shrink-0 space-y-3">
            <Card>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-46">{t('alarms.detail.query')}</p>
              <code className="block font-mono text-[11px] leading-5 text-ink-68">{alarm.tag} → {alarm.rule}</code>
            </Card>
            <Card>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-46">{t('alarms.detail.nextSteps')}</p>
              <div className="space-y-1.5">
                {alarm.state === 'active' && operable && (
                  <button className="btn btn-sm w-full" onClick={() => {
                    void api.ackAlarm(alarm.id)
                      .then(() => live.upsertAlarm({ ...alarm, state: 'acked' }))
                      .catch((e) => setErr(String((e as Error).message ?? e)));
                  }}>{t('alarms.ack')}</button>
                )}
                <Link to="/admin/rules" className="btn btn-sm btn-ghost w-full">{t('nav.adminRules')}</Link>
                <Link to="/tags" className="btn btn-sm btn-ghost w-full">{t('nav.tags')}</Link>
              </div>
            </Card>
          </aside>
        </div>
      </div>
    </>
  );
}
