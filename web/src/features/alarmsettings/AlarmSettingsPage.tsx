// Alarm settings — read-only rollup of the alarm rules (counts by severity,
// enabled state); editing stays in Admin → Alarm rules.

import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../../lib/api';
import { EmptyState, ErrorState, SkeletonRows } from '../../shared/ui/Feedback';
import { ProductHeader } from '../../shared/ui/Product';
import { SeverityBadge } from '../../shared/ui/Status';
import '../misc/i18n';

export function AlarmSettingsPage() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['alarm-rules'], queryFn: api.alarmRules });
  const rules = q.data ?? [];
  const on = rules.filter((r) => r.enabled).length;
  const bySev = ['critical', 'warning', 'info'].map((s) => [s, rules.filter((r) => r.severity === s).length] as const);
  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader icon="cog" title={t('px.alarmSettings.title')}
        actions={<Link to="/admin/rules" className="btn btn-sm">{t('px.alarmSettings.manage')}</Link>} />
      <div className="space-y-3 p-4">
        {q.isLoading ? <SkeletonRows /> : q.isError ? <ErrorState onRetry={q.refetch} /> : rules.length === 0 ? <EmptyState title={t('px.empty')} icon="search" /> : (
          <>
            <div className="flex flex-wrap gap-6 rounded-[5px] border border-line bg-white p-4 text-[12px] text-ink-68">
              <span><b className="block font-mono text-[22px] text-ink">{rules.length}</b>{t('px.alarmSettings.total')}</span>
              <span><b className="block font-mono text-[22px] text-ink">{on}</b>{t('px.alarmSettings.enabled')}</span>
              <span><b className="block font-mono text-[22px] text-ink">{rules.length - on}</b>{t('px.alarmSettings.disabled')}</span>
              {bySev.map(([s, n]) => <span key={s}><b className="block font-mono text-[22px] text-ink">{n}</b><SeverityBadge severity={s} /></span>)}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse rounded-[5px] border border-line bg-white text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left">
                    {['colRule', 'colTag', 'colKind', 'colThreshold', 'colSeverity', 'colState'].map((c) => (
                      <th key={c} scope="col" className="h-8 px-3 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-68">{t(`px.alarmSettings.${c}`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rules.map((r) => (
                    <tr key={r.name} className="h-9 border-b border-line last:border-0">
                      <td className="px-3 font-medium">{r.name}</td>
                      <td className="px-3 font-mono text-[12px] text-ink-68">{r.tag ?? '—'}</td>
                      <td className="px-3">{r.kind}</td>
                      <td className="px-3 font-mono">{r.threshold ?? (r.stale_s != null ? `${r.stale_s}s` : '—')}</td>
                      <td className="px-3"><SeverityBadge severity={r.severity} /></td>
                      <td className="px-3">{r.enabled ? t('px.alarmSettings.enabled') : t('px.alarmSettings.disabled')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
