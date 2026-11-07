// Plan & usage — settings -> plan (roadmap §10 6.2). Usage vs cap per
// resource, warning at 80%, upgrade copy (no payments — plans are set by
// the WDS team from the platform back-office).

import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import './i18n';
import { planApi } from './api';
import { useAdminOrg } from '../admin/admin';
import { PageBar, Card } from '../../shared/ui/Page';
import { PageSkeleton, ErrorState, Notice } from '../../shared/ui/Feedback';

import { capLabelKey } from './capLabel';

/** One usage-vs-cap row; the bar turns red at 80% of a finite cap. */
function UsageBar({ label, usage, cap, warn }: {
  label: string; usage: number; cap: number | null; warn: (s: string) => string;
}) {
  const { t } = useTranslation();
  const frac = cap == null ? 0 : Math.min(1, cap === 0 ? (usage > 0 ? 1 : 0) : usage / cap);
  const hot = cap != null && frac >= 0.8;
  return (
    <div className="border-b border-line py-2 last:border-0">
      <div className="flex items-baseline justify-between text-[13px]">
        <span>{label}</span>
        <span className={hot ? 'font-semibold text-[var(--color-danger)]' : 'text-ink-68'}>
          {usage} {t('plat.of')} {cap == null ? t('plat.unlimited') : cap}
        </span>
      </div>
      {cap != null && (
        <div className="mt-1 h-1.5 rounded bg-subtle">
          <div
            className={`h-1.5 rounded ${hot ? 'bg-[var(--color-danger)]' : 'bg-blue'}`}
            style={{ width: `${Math.round(frac * 100)}%` }}
            title={hot ? warn(label) : undefined}
          />
        </div>
      )}
    </div>
  );
}

/** Last 30 days of each metered resource (daily peak), as a small table of first and latest value. */
function DailyUsage({ rows }: { rows: { day: string; metric: string; value: number }[] }) {
  const { t } = useTranslation();
  const by = new Map<string, { day: string; value: number }[]>();
  for (const r of rows) by.set(r.metric, [...(by.get(r.metric) ?? []), r]);
  if (by.size === 0) return <p className="text-[13px] text-ink-68">{t('plat.dailyNone')}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px]">
        <thead><tr>{['dailyMetric', 'dailyFrom', 'dailyNow', 'dailyPeak'].map((k) => <th key={k} scope="col" className="px-2 py-1 text-[11px] font-semibold text-ink-68">{t(`plat.${k}`)}</th>)}</tr></thead>
        <tbody>{[...by.entries()].map(([k, v]) => (
          <tr key={k} className="border-t border-line">
            <td className="px-2 py-1">{t(`plat.${capLabelKey(k)}`)}</td>
            <td className="px-2 py-1 tabular-nums">{v[0].value} <span className="text-ink-46">({v[0].day})</span></td>
            <td className="px-2 py-1 tabular-nums">{v[v.length - 1].value}</td>
            <td className="px-2 py-1 tabular-nums">{Math.max(...v.map((x) => x.value))}</td>
          </tr>))}</tbody>
      </table>
    </div>
  );
}

// Set VITE_SUPPORT_EMAIL at build time; without it the upgrade link is hidden
// rather than pointing at a placeholder address.
const SUPPORT_EMAIL = (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined) ?? '';

export function PlanPage() {
  const { t } = useTranslation();
  const { orgId, orgName, loading } = useAdminOrg();
  const q = useQuery({
    queryKey: ['org-usage', orgId],
    queryFn: () => planApi.usage(orgId!),
    enabled: !!orgId,
    refetchInterval: 60_000,
  });
  const d = q.data;
  return (
    <>
      <PageBar title={t('plat.planTitle')} lede={t('plat.planLede')} />
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        {loading || q.isPending ? <PageSkeleton rows={4} />
          : q.isError ? <Card pad={false}><ErrorState onRetry={() => void q.refetch()} /></Card>
          : d && (
          <>
            {d.suspended && <Notice tone="error">{t('plat.suspended')}</Notice>}
            <Card title={`${orgName ?? ''} — ${t('plat.plan')}: ${d.plan}`}>
              {d.trial_ends_at && (
                <div className="mb-2 text-[12px] text-ink-68">
                  {t('plat.trialEnds')}: {new Date(d.trial_ends_at).toLocaleString()}
                </div>
              )}
              {Object.entries(d.usage).map(([k, u]) => (
                <UsageBar key={k} label={t(`plat.${capLabelKey(k)}`)}
                          usage={u.usage} cap={u.cap}
                          warn={() => t('plat.nearLimit')} />
              ))}
            </Card>
            <Card title={t('plat.dailyTitle')}>
              <DailyUsage rows={d.daily ?? []} />
            </Card>
            <Card title={t('plat.upgradeTitle')}>
              <p className="mb-2 text-[13px] text-ink-68">{t('plat.upgradeBody')}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-68">
                <span>{t('plat.retention')}: {d.features.retention_days} {t('plat.days')}</span>
                <span>{t('plat.apiRate')}: {d.features.api_rate_per_min}</span>
                {d.features.sso && <span>{t('plat.featSso')}</span>}
                {d.features.audit_export && <span>{t('plat.featAuditExport')}</span>}
                {d.features.sms && <span>{t('plat.featSms')}</span>}
                {d.features.assistant && <span>{t('plat.featAssistant')}</span>}
              </div>
              {SUPPORT_EMAIL && (
                <a className="btn btn-primary mt-3 inline-block h-9 text-[13px] font-semibold"
                   href={`mailto:${SUPPORT_EMAIL}?subject=Plan%20upgrade`}>
                  {t('plat.upgradeCta')}
                </a>
              )}
            </Card>
          </>
        )}
      </div>
    </>
  );
}
