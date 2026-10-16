// Infrastructure → Profiles: the protocol profiles an edge gateway can run
// (the adapters shipped in edge-bridge), what each one needs, and how many of
// this site's gateways use it. Read-only: a gateway picks its profile with the
// ADAPTER env var at install time (Add device wizard).

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../../lib/api';
import { useAdminOrg, useAdminSite } from '../admin/admin';
import { ErrorState, Skeleton } from '../../shared/ui/Feedback';
import { ProductHeader } from '../../shared/ui/Product';
import { DEVICE_TABS } from './tabs';

interface Profile { id: string; ready: boolean; settings: string[]; tagTypes: string[]; }
const PROFILES: Profile[] = [
  { id: 'modbus', ready: true, settings: ['MODBUS_HOST', 'MODBUS_PORT', 'unit_id', 'request_timeout_ms'], tagTypes: ['coil', 'discrete_input', 'holding_register', 'input_register'] },
  { id: 'sim', ready: true, settings: ['POLL_MS'], tagTypes: ['state', 'conv_speed', 'conv_temp', 'bin_level', 'random_walk'] },
  { id: 'opcua', ready: false, settings: [], tagTypes: [] },
  { id: 's7', ready: false, settings: [], tagTypes: [] },
];

export function ProfilesPage() {
  const { t } = useTranslation();
  const { orgId } = useAdminOrg();
  const { site } = useAdminSite(orgId);
  const devices = useQuery({
    queryKey: ['devices', orgId, site?.id],
    queryFn: () => adminApi.devices(orgId!, site!.id),
    enabled: !!orgId && !!site,
  });
  const used = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of devices.data?.items ?? []) {
      if (d.status === 'disabled') continue;
      m.set(d.adapter ?? 'unknown', (m.get(d.adapter ?? 'unknown') ?? 0) + 1);
    }
    return m;
  }, [devices.data]);

  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader icon="server" title={t('dev.product')} tabs={DEVICE_TABS(t)} lede={t('dev.profLede')} />
      <div className="flex-1 p-4">
        {devices.isError ? <ErrorState onRetry={() => void devices.refetch()} /> : devices.isLoading ? <Skeleton h={200} /> : (
          <div className="overflow-x-auto rounded-[5px] border border-line bg-white">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-left">
                  {['profColProfile', 'profColSettings', 'profColTags', 'profColDevices'].map((c) => (
                    <th key={c} scope="col" className="h-8 px-3 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-68">{t(`dev.${c}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PROFILES.map((p) => (
                  <tr key={p.id} className="border-b border-line align-top last:border-0">
                    <td className="px-3 py-3">
                      <p className="font-medium text-ink">{t(`dev.type.${p.id}.name`)}</p>
                      <p className="mt-0.5 max-w-xs text-[12px] text-ink-68">{t(`dev.type.${p.id}.body`)}</p>
                    </td>
                    <td className="px-3 py-3 font-mono text-[12px] text-ink-68">
                      {p.ready ? p.settings.join(', ') : <span className="font-sans italic text-ink-46">{t('dev.soon')}</span>}
                    </td>
                    <td className="px-3 py-3 font-mono text-[12px] text-ink-68">{p.tagTypes.join(', ') || '—'}</td>
                    <td className="px-3 py-3">
                      {p.ready ? (
                        <Link to={`/infrastructure?q=${encodeURIComponent(`adapter:${p.id}`)}`} className="text-blue hover:underline">
                          {t('dev.profDevices', { count: used.get(p.id) ?? 0 })}
                        </Link>
                      ) : '—'}
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
