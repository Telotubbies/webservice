// Infrastructure → Map: the site's data path drawn as a topology — site, its
// edge gateways, and the equipment their signals belong to. Gateway colour is
// the heartbeat state; equipment colour is live signal freshness. Tags are not
// bound to a single gateway in the API, so every gateway links to every
// equipment node rather than inventing a mapping.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../../lib/api';
import { useNow, useStore } from '../../lib/hooks';
import { live, STALE_MS } from '../../lib/live';
import { useAdminOrg, useAdminSite } from '../admin/admin';
import { EmptyState, ErrorState, Skeleton } from '../../shared/ui/Feedback';
import { ProductHeader } from '../../shared/ui/Product';
import { deviceState, isAbnormal, STATE_STYLE, type DeviceState } from './devices';
import { DEVICE_TABS } from './tabs';

const COL_X = [90, 380, 700];
const ROW = 64;

type Fresh = 'fresh' | 'stale' | 'none';
const FRESH_STYLE: Record<Fresh, string> = {
  fresh: 'var(--color-ok)', stale: 'var(--color-caution)', none: 'var(--color-ink-46, #8a8f9c)',
};
const FRESH_GLYPH: Record<Fresh, string> = { fresh: '●', stale: '◆', none: '○' };

export function NetworkMapPage() {
  const { t } = useTranslation();
  const now = useNow();
  const { orgId } = useAdminOrg();
  const { site } = useAdminSite(orgId);
  useStore(() => live.version);

  const devices = useQuery({
    queryKey: ['devices', orgId, site?.id],
    queryFn: () => adminApi.devices(orgId!, site!.id),
    enabled: !!orgId && !!site, refetchInterval: 10_000,
  });
  const tags = useQuery({
    queryKey: ['admin-tags', orgId, site?.id],
    queryFn: () => adminApi.siteTags(orgId!, site!.id),
    enabled: !!orgId && !!site,
  });

  const gateways = useMemo(
    () => (devices.data?.items ?? []).map((d) => ({ d, state: deviceState(d, now) })),
    [devices.data, now],
  );

  // equipment = first three path segments below the site: area.line.device
  const equipment = useMemo(() => {
    const m = new Map<string, { key: string; signals: string[]; fresh: Fresh; known: number }>();
    for (const tg of tags.data?.items ?? []) {
      const parts = tg.path.split('.');
      const key = parts.length > 1 ? parts.slice(0, -1).join('.') : tg.path;
      const e = m.get(key) ?? { key, signals: [], fresh: 'none' as Fresh, known: 0 };
      e.signals.push(parts[parts.length - 1]);
      const tv = live.latest.get(`${site?.code}.${tg.path}`) ?? live.latest.get(tg.path);
      if (tv) {
        e.known++;
        const ok = now - Date.parse(tv.ts) <= STALE_MS;
        if (ok && e.fresh !== 'stale') e.fresh = 'fresh';
        if (!ok) e.fresh = 'stale';
      }
      m.set(key, e);
    }
    return [...m.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [tags.data, site?.code, now]);

  const rows = Math.max(gateways.length, equipment.length, 1);
  const height = rows * ROW + 40;
  const gy = (i: number, n: number) => 20 + ((height - 40) / Math.max(n, 1)) * (i + 0.5);
  const siteY = height / 2;

  const loading = devices.isLoading || tags.isLoading;
  const bad = devices.isError || tags.isError;
  const abnormal = gateways.filter((g) => isAbnormal(g.state)).length;

  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader icon="server" title={t('dev.product')} tabs={DEVICE_TABS(t)}
        lede={t('dev.mapLede')}
        status={abnormal > 0 ? t('dev.mapAbnormal', { count: abnormal }) : undefined} />
      <div className="flex-1 p-4">
        {loading ? <Skeleton h={240} /> : bad ? (
          <ErrorState onRetry={() => { void devices.refetch(); void tags.refetch(); }} />
        ) : !site || (gateways.length === 0 && equipment.length === 0) ? (
          <EmptyState title={t('dev.mapEmpty')} icon="search"
            action={<Link to="/infrastructure/add" className="text-blue hover:underline">{t('dev.add')}</Link>} />
        ) : (
          <div className="overflow-x-auto rounded-[5px] border border-line bg-white p-3">
            <svg role="img" aria-label={t('dev.mapAria', { gateways: gateways.length, equipment: equipment.length })}
              viewBox={`0 0 900 ${height}`} className="w-full min-w-[720px]" style={{ height }}>
              {gateways.flatMap((g, gi) => equipment.map((e, ei) => (
                <line key={`${g.d.id}-${e.key}`} x1={COL_X[1] + 70} y1={gy(gi, gateways.length)}
                  x2={COL_X[2] - 10} y2={gy(ei, equipment.length)}
                  stroke="var(--color-line-hard, #c2c8dd)" strokeWidth={1}
                  strokeDasharray={g.state === 'online' ? undefined : '4 3'} opacity={0.7} />
              )))}
              {gateways.map((g, gi) => (
                <line key={g.d.id} x1={COL_X[0] + 60} y1={siteY} x2={COL_X[1] - 70} y2={gy(gi, gateways.length)}
                  stroke="var(--color-line-hard, #c2c8dd)" strokeWidth={1.5}
                  strokeDasharray={g.state === 'online' ? undefined : '4 3'} />
              ))}

              <g>
                <rect x={COL_X[0] - 60} y={siteY - 24} width={120} height={48} rx={5} fill="var(--color-subtle, #f4f5f8)" stroke="var(--color-line-hard, #c2c8dd)" />
                <text x={COL_X[0]} y={siteY - 3} textAnchor="middle" fontSize={12} fontWeight={600} fill="currentColor">{site?.name}</text>
                <text x={COL_X[0]} y={siteY + 13} textAnchor="middle" fontSize={10} fill="currentColor" opacity={0.6}>{site?.code}</text>
              </g>

              {gateways.map((g, gi) => {
                const y = gy(gi, gateways.length);
                const s = g.state as DeviceState;
                return (
                  <Link key={g.d.id} to={`/infrastructure?device=${g.d.id}`} aria-label={`${g.d.name}: ${t(`dev.state.${s}`)}`}>
                    <rect x={COL_X[1] - 70} y={y - 22} width={140} height={44} rx={5}
                      fill={s === 'online' ? 'var(--color-ok-soft)' : s === 'stale' ? 'var(--color-caution-soft)' : s === 'offline' ? 'var(--color-danger-soft)' : 'var(--color-subtle, #f4f5f8)'}
                      stroke={s === 'online' ? 'var(--color-ok)' : s === 'stale' ? 'var(--color-caution)' : s === 'offline' ? 'var(--color-danger)' : 'var(--color-line-hard, #c2c8dd)'} />
                    <text x={COL_X[1] - 58} y={y - 3} fontSize={12} fontWeight={600} fill="currentColor">{STATE_STYLE[s].glyph} {g.d.name.slice(0, 16)}</text>
                    <text x={COL_X[1] - 58} y={y + 13} fontSize={10} fill="currentColor" opacity={0.7}>{t(`dev.state.${s}`)}{g.d.adapter ? ` · ${g.d.adapter}` : ''}</text>
                  </Link>
                );
              })}

              {equipment.map((e, ei) => {
                const y = gy(ei, equipment.length);
                return (
                  <Link key={e.key} to={`/tags?q=${encodeURIComponent(e.key)}`} aria-label={`${e.key}: ${t(`dev.fresh_${e.fresh}`)}`}>
                    <rect x={COL_X[2] - 10} y={y - 22} width={200} height={44} rx={5} fill="#fff" stroke={FRESH_STYLE[e.fresh]} strokeWidth={1.5} />
                    <text x={COL_X[2]} y={y - 3} fontSize={11} fontWeight={600} fill="currentColor">{FRESH_GLYPH[e.fresh]} {e.key.split('.').slice(-2).join('.')}</text>
                    <text x={COL_X[2]} y={y + 13} fontSize={10} fill="currentColor" opacity={0.7}>
                      {t('dev.mapSignals', { count: e.signals.length })} · {t(`dev.fresh_${e.fresh}`)}
                    </text>
                  </Link>
                );
              })}

              {[t('dev.mapColSite'), t('dev.mapColGateway'), t('dev.mapColEquipment')].map((label, i) => (
                <text key={label} x={COL_X[i] + (i === 2 ? 90 : 0)} y={12} textAnchor="middle" fontSize={10} letterSpacing={1.2} fill="currentColor" opacity={0.55}>{label.toUpperCase()}</text>
              ))}
            </svg>
            <p className="mt-2 text-[11px] text-ink-46">{t('dev.mapNote')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
