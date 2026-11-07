// Plan comparison (F16): every plan's real limits side by side, the current
// plan marked, and this org's usage against its own caps.

import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { request } from '../../lib/api';
import { planApi } from '../platform/api';
import { useAdminOrg } from '../admin/admin';
import { PageBar, Card } from '../../shared/ui/Page';
import { PageSkeleton, ErrorState } from '../../shared/ui/Feedback';
import './planI18n';

interface PlanRow {
  code: string; name: string; max_sites: number | null; max_edges: number | null; max_tags: number | null;
  max_users: number | null; max_cameras: number | null; max_vision_models: number | null;
  retention_days: number | null; gpu_hours_monthly: number; api_rate_per_min: number;
  sso: boolean; audit_export: boolean; sms: boolean; assistant: boolean;
}

const LIMITS: { key: keyof PlanRow; use?: string }[] = [
  { key: 'max_sites', use: 'max_sites' }, { key: 'max_edges', use: 'max_edges' }, { key: 'max_tags', use: 'max_tags' },
  { key: 'max_users', use: 'max_users' }, { key: 'max_cameras', use: 'max_cameras' }, { key: 'max_vision_models', use: 'max_vision_models' },
  { key: 'retention_days' }, { key: 'gpu_hours_monthly', use: 'gpu_hours_monthly' }, { key: 'api_rate_per_min' },
];
const FLAGS: (keyof PlanRow)[] = ['sso', 'audit_export', 'sms', 'assistant'];

export function PlanComparePage() {
  const { t } = useTranslation();
  const { orgId } = useAdminOrg();
  const plans = useQuery({ queryKey: ['plans', orgId], enabled: !!orgId, queryFn: () => request<{ items: PlanRow[] }>(`/api/v1/orgs/${encodeURIComponent(orgId!)}/plans`) });
  const usage = useQuery({ queryKey: ['org-usage', orgId], enabled: !!orgId, queryFn: () => planApi.usage(orgId!) });
  const items = plans.data?.items ?? [];
  const cur = usage.data?.plan;
  const val = (v: unknown) => (v === null ? t('plc.unlimited') : typeof v === 'boolean' ? (v ? t('plc.yes') : t('plc.no')) : String(v));
  return (
    <>
      <PageBar title={t('plc.title')} lede={t('plc.lede')} back={{ to: '/settings/plan', label: t('plat.planTitle') }} />
      <div className="mx-auto max-w-4xl p-4">
        {plans.isError ? <Card pad={false}><ErrorState onRetry={() => void plans.refetch()} /></Card>
          : plans.isPending ? <PageSkeleton rows={6} /> : (
          <Card pad={false}>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead><tr className="border-b border-line text-left">
                  <th className="px-3 py-2 text-[11px] font-medium text-ink-68">{t('plc.limit')}</th>
                  <th className="px-3 py-2 text-[11px] font-medium text-ink-68">{t('plc.yours')}</th>
                  {items.map((p) => (
                    <th key={p.code} className={`px-3 py-2 font-semibold ${p.code === cur ? 'bg-blue/10' : ''}`}>
                      {p.name}{p.code === cur && <span className="ml-1 text-[11px] font-normal text-blue">{t('plc.current')}</span>}
                    </th>))}
                </tr></thead>
                <tbody>
                  {LIMITS.map((l) => {
                    const u = l.use ? usage.data?.usage[l.use] : undefined;
                    return (
                      <tr key={l.key} className="border-b border-line">
                        <th scope="row" className="px-3 py-1.5 text-left font-normal">{t(`plc.${l.key}`)}</th>
                        <td className="px-3 py-1.5 tabular-nums text-ink-68">{u ? `${u.usage} / ${u.cap ?? t('plc.unlimited')}` : '—'}</td>
                        {items.map((p) => <td key={p.code} className={`px-3 py-1.5 tabular-nums ${p.code === cur ? 'bg-blue/10' : ''}`}>{val(p[l.key])}</td>)}
                      </tr>);
                  })}
                  {FLAGS.map((f) => (
                    <tr key={f} className="border-b border-line last:border-0">
                      <th scope="row" className="px-3 py-1.5 text-left font-normal">{t(`plc.${f}`)}</th>
                      <td className="px-3 py-1.5 text-ink-68">{usage.data ? val(usage.data.features[f as 'sso']) : '—'}</td>
                      {items.map((p) => <td key={p.code} className={`px-3 py-1.5 ${p.code === cur ? 'bg-blue/10' : ''}`}>{val(p[f])}</td>)}
                    </tr>))}
                </tbody>
              </table>
            </div>
          </Card>)}
        <p className="mt-3 text-[12px] text-ink-68">{t('plc.note')}</p>
      </div>
    </>
  );
}
