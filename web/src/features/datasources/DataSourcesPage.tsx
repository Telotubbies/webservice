// Infrastructure -> Data sources: gateway list with config sync state
// (Applied vN / Pending vN / Error) linking to each gateway's sources.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { adminApi, type Device } from '../../lib/api';
import { useNow } from '../../lib/hooks';
import { useAdminOrg, useAdminSite } from '../admin/admin';
import { EmptyState, ErrorState, SkeletonRows } from '../../shared/ui/Feedback';
import { ProductHeader } from '../../shared/ui/Product';
import { CAUTION_TEXT_CLASS, deviceState, STATE_STYLE, type DeviceState } from '../devices/devices';
import { DEVICE_TABS } from '../devices/tabs';
import { configState, type ConfigState } from './logic';
import './i18n';

export function ConfigChip({ state }: { state: ConfigState }) {
  const { t } = useTranslation();
  if (state.kind === 'none') return <span className="text-ink-46">{t('ds.cfgNone')}</span>;
  if (state.kind === 'applied') return <span>✓ {t('ds.cfgApplied', { v: state.version })}</span>;
  if (state.kind === 'pending') return <span className={CAUTION_TEXT_CLASS}>◆ {t('ds.cfgPending', { v: state.version })}</span>;
  return <span className="text-[var(--color-danger)]" title={state.message}>▲ {t('ds.cfgError', { message: state.message })}</span>;
}

export function StateChip({ state }: { state: DeviceState }) {
  const { t } = useTranslation();
  const s = STATE_STYLE[state];
  return <span className={`inline-flex items-center gap-1 rounded px-1.5 text-[11px] font-semibold ${s.pill}`}><span aria-hidden>{s.glyph}</span>{t(`dev.state.${state}`)}</span>;
}

export function DataSourcesPage() {
  const { t } = useTranslation();
  const now = useNow();
  const { orgId } = useAdminOrg();
  const { site } = useAdminSite(orgId);
  const list = useQuery({
    queryKey: ['devices', orgId, site?.id],
    queryFn: () => adminApi.devices(orgId!, site!.id),
    enabled: !!orgId && !!site,
    refetchInterval: 10_000,
  });
  const rows = useMemo(() => (list.data?.items ?? []).filter((d) => d.status !== 'disabled')
    .map((d: Device) => ({ d, state: deviceState(d, now), cfg: configState(d) })), [list.data, now]);

  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader icon="server" title={t('dev.product')} tabs={DEVICE_TABS(t)} lede={t('ds.lede')} />
      <div className="flex-1 p-4">
        {list.isError ? <ErrorState onRetry={() => void list.refetch()} /> : list.isLoading || !site ? <SkeletonRows rows={4} /> : rows.length === 0 ? (
          <EmptyState icon="info" title={t('ds.noGateways')} body={t('ds.noGatewaysHint')} action={<Link to="/infrastructure/add" className="btn btn-sm">{t('dev.add')}</Link>} />
        ) : (
          <div className="overflow-x-auto rounded-[5px] border border-line bg-white">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-left">
                  {['colGateway', 'colStatus', 'colAdapter', 'colConfig', ''].map((c) => (
                    <th key={c || 'act'} scope="col" className="h-8 px-3 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-68">{c && t(`ds.${c}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ d, state, cfg }) => (
                  <tr key={d.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2 font-medium">{d.name}</td>
                    <td className="px-3 py-2"><StateChip state={state} /></td>
                    <td className="px-3 py-2">{t(`dev.adapter.${d.adapter ?? 'unknown'}`, { defaultValue: d.adapter ?? '' })}</td>
                    <td className="px-3 py-2"><ConfigChip state={cfg} /></td>
                    <td className="px-3 py-2 text-right">
                      <Link to={`/infrastructure/sources/${d.id}`} className="btn btn-sm btn-ghost whitespace-nowrap" aria-label={`${t('ds.manage')} — ${d.name}`}>
                        {t('ds.manage')} <ChevronRight size={13} aria-hidden />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
