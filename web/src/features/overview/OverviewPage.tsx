// Overview — KPI strip over the live store: signal cards (value + sparkline),
// active alarms rail, open insights count. Data arrives via live buffers —
// skeletons until the first seed, never a fake "quiet" state.

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { live, STALE_MS } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { T, SIGNALS, formatSignal, unitOf } from '../../lib/plant';
import { fmtAge } from '../../lib/format';
import { useAlarms } from '../alarms/alarms';
import { SeverityBadge, QualityMark, type RunState } from '../../shared/ui/Status';
import { Sparkline } from '../../shared/ui/Sparkline';
import { PageBar, Card } from '../../shared/ui/Page';
import { EmptyState, PageSkeleton, ErrorState } from '../../shared/ui/Feedback';
import { Icon } from '../../shared/ui/Icon';
import { LineStatusBar } from '../../shared/ui/LineStatusBar';
import { OnboardingCard } from '../onboarding/OnboardingCard';

function signalState(tag: string, now: number): RunState {
  const tv = live.latest.get(tag);
  if (!tv) return 'unknown';
  if (now - Date.parse(tv.ts) > STALE_MS || tv.q === 'stale') return 'stale';
  if (tag === T.running) return tv.v ? 'running' : 'stopped';
  return tv.q === 'bad' ? 'stale' : 'running';
}

function KpiCard({ tag, limit }: { tag: string; limit?: number }) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  useStore(() => live.version);
  const meta = SIGNALS[tag];
  const tv = live.latest.get(tag);
  const state = signalState(tag, now);
  const val = tv ? formatSignal(tag, tv.v, i18n.language) : '—';
  const unit = unitOf(tag);
  return (
    <Card pad={false}>
      <div className="flex h-[86px] flex-col px-3 py-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-46">
          <span className="truncate">{t(meta?.labelKey ?? tag)}</span>
          {meta?.stub && (
            <span className="rounded border border-dashed border-[var(--color-caution)] px-1 text-[9px] text-[var(--color-caution)]" title={t('overview.stubTitle')}>
              {t('overview.stub')}
            </span>
          )}
          <span className="flex-1" />
          <QualityMark q={tv?.q} stale={state === 'stale'} />
        </div>
        <div className="mt-0.5 flex items-baseline gap-1">
          <span className="font-mono text-[22px] font-semibold leading-none text-ink">{val}</span>
          {unit && <span className="text-[11px] text-ink-46">{unit}</span>}
        </div>
        <div className="mt-auto">
          <Sparkline tag={tag} limit={limit} />
        </div>
      </div>
    </Card>
  );
}

export function OverviewPage() {
  const { t } = useTranslation();
  const now = useNow();
  const seeded = useStore(() => live.tagRev);
  const seedError = useStore(() => live.seedRev);
  useStore(() => live.version);
  const ws = useStore(() => live.ws);
  const { active } = useAlarms();
  const insightRev = useStore(() => live.insightRev);
  const openInsights = live.insights.filter((i) => i.state === 'open');
  const qc = useQueryClient();
  void insightRev;

  /** Re-run the boot seed (mirrors useLiveBoot in App) so the error state
   *  offers a real retry instead of a dead end. */
  const retrySeed = () => {
    void qc.invalidateQueries({ queryKey: ['tags'] });
    void api.latestAll().then((rows) => rows.forEach((r) => live.pushTag(r.name, r.v, r.q, r.ts)))
      .catch(() => live.setSeedError());
    void api.alarms().then((a) => live.setAlarms(a)).catch(() => live.setSeedError());
    void api.insights({ state: 'open' }).then((a) => live.setInsights(a)).catch(() => live.setSeedError());
  };

  if (seedError && !live.tagsSeeded) return <><PageBar title={t('overview.title')} /><ErrorState onRetry={retrySeed} /></>;
  if (!live.tagsSeeded && !seeded) return <><PageBar title={t('overview.title')} /><PageSkeleton /></>;

  return (
    <>
      <PageBar
        title={t('overview.title')}
        lede={t('overview.lede')}
        actions={
          <Link to="/line" className="btn btn-sm btn-ghost">
            {t('overview.openLine')} <Icon name="arrow-right" size={13} />
          </Link>
        }
      />
      <div className="flex flex-col gap-3 p-4">
        {/* first-run checklist — self-hides when dismissed/complete */}
        <OnboardingCard />

        <LineStatusBar />

        {/* KPI grid */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <KpiCard tag={T.beltSpeed} />
          <KpiCard tag={T.beltTemp} limit={80} />
          <KpiCard tag={T.binLevel} limit={90} />
          <KpiCard tag={T.gravel} />
          <KpiCard tag={T.speedSp} />
          <KpiCard tag={T.running} />
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <Card
            title={`${t('overview.activeAlarms')} (${active.length})`}
            actions={<Link to="/alarms" className="text-[12px] text-blue">{t('insights.viewAll')}</Link>}
            pad={false}
          >
            {active.length === 0 ? (
              <EmptyState
                title={ws !== 'open' ? t('alarms.emptyUnknown') : t('overview.noActive')}
                body={ws !== 'open' ? t('alarms.emptyUnknownBody') : t('overview.noActiveBody')}
              />
            ) : (
              <ul>
                {active.slice(0, 6).map((a) => (
                  <li key={a.id}>
                    <Link
                      to={`/alarms/${a.id}`}
                      className="flex h-9 items-center gap-2 border-b border-line px-3 last:border-0 hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none"
                    >
                      <SeverityBadge severity={a.severity} />
                      <span className="min-w-0 flex-1 truncate text-[13px]">
                        {a.rule} <span className="font-mono text-[11px] text-ink-46">{a.tag.split('.').slice(-1)[0]}</span>
                      </span>
                      <span className="text-[11px] text-ink-46">{fmtAge(a.ts, now)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={`${t('nav.insights')} (${openInsights.length})`} pad={false}>
            {openInsights.length === 0 ? (
              <EmptyState title={t('insights.empty')} body={t('insights.emptyBody')} icon="sparkle" />
            ) : (
              <ul>
                {openInsights.slice(0, 6).map((i) => (
                  <li key={i.id}>
                    <Link
                      to="/insights"
                      className="flex h-9 items-center gap-2 border-b border-line px-3 last:border-0 hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none"
                    >
                      <SeverityBadge severity={i.severity} />
                      <span className="min-w-0 flex-1 truncate text-[13px]">
                        {t(`insights.kind${i.kind[0].toUpperCase()}${i.kind.slice(1)}`)} · <span className="font-mono text-[11px] text-ink-46">{i.tag.split('.').slice(-1)[0]}</span>
                      </span>
                      <span className="font-mono text-[11px] text-ink-46">{i.score.toFixed(2)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
