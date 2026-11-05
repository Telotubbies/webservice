// Infrastructure → Map: the site's data path drawn as a topology — site, its
// edge gateways, and the equipment their signals belong to. Gateway colour is
// the heartbeat state; equipment colour is live signal freshness. A line joins
// a gateway to an equipment group only when one of that gateway's own data
// sources reads a tag under it (mapModel.ts); disabled and never-connected
// gateways fold into one "Parked (n)" node instead of meshing.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useQueries, useQuery } from '@tanstack/react-query';
import { dsApi } from '../datasources/api';
import { equipmentKey, gatewayLinks, pathSep, splitGateways } from './mapModel';
import { adminApi } from '../../lib/api';
import { useNow, useStore } from '../../lib/hooks';
import { live, STALE_MS } from '../../lib/live';
import { useAdminOrg, useAdminSite } from '../admin/admin';
import { EmptyState, ErrorState, Skeleton } from '../../shared/ui/Feedback';
import { ProductHeader } from '../../shared/ui/Product';
import { deviceState, isAbnormal, STATE_STYLE, type DeviceState } from './devices';
import { DEVICE_TABS } from './tabs';

// Fixed three-column layout inside the 900-wide viewBox: site, gateway, equipment.
const COL_X = [90, 380, 700];
const ROW = 64;

/** Signal freshness per equipment node, from the live tag cache. */
type Fresh = 'fresh' | 'stale' | 'none';
const FRESH_STYLE: Record<Fresh, string> = {
  // live signals are normal → neutral outline; only stale takes colour (ISA-101)
  fresh: 'var(--color-line-hard)', stale: 'var(--color-caution)', none: 'var(--color-ink-35)',
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

  const split = useMemo(() => splitGateways(devices.data?.items ?? []), [devices.data]);
  const gateways = useMemo(
    () => split.active.map((d) => ({ d, state: deviceState(d, now) })),
    [split, now],
  );
  // Each active gateway's sources, then each source's tags: the only honest
  // answer to "which equipment does this gateway feed".
  const sourceQs = useQueries({
    queries: split.active.map((d) => ({
      queryKey: ['map-sources', orgId, d.id],
      queryFn: async () => {
        const srcs = (await dsApi.sources(orgId!, d.id)).items;
        const lists = await Promise.all(srcs.map((x) => dsApi.tags(orgId!, d.id, x.id).then((r) => r.items, () => [])));
        return { edge: d.id, paths: lists.flat().map((tg) => tg.path) };
      },
      enabled: !!orgId, staleTime: 60_000,
    })),
  });
  const linkKey = sourceQs.map((q) => q.dataUpdatedAt).join();
  const links = useMemo(
    () => gatewayLinks(new Map(sourceQs.flatMap((q) => (q.data ? [[q.data.edge, q.data.paths] as [string, string[]]] : [])))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [linkKey],
  );

  // equipment = first three path segments below the site: area.line.device
  const equipment = useMemo(() => {
    const m = new Map<string, { key: string; signals: string[]; fresh: Fresh; known: number }>();
    for (const tg of tags.data?.items ?? []) {
      const parts = tg.path.split(pathSep(tg.path));
      const key = equipmentKey(tg.path);
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

  const parked = split.parked.length;
  const gwRows = gateways.length + (parked ? 1 : 0);
  const rows = Math.max(gwRows, equipment.length, 1);
  const height = rows * ROW + 40;
  const gy = (i: number, n: number) => 20 + ((height - 40) / Math.max(n, 1)) * (i + 0.5);
  const siteY = height / 2;

  const loading = devices.isLoading || tags.isLoading;
  const bad = devices.isError || tags.isError;
  const abnormal = gateways.filter((g) => isAbnormal(g.state)).length;

  return (
    <div className="flex min-h-[calc(100svh-var(--h-topbar))] flex-col">
      <ProductHeader icon="server" title={t('dev.product')} tabs={DEVICE_TABS(t)}
        lede={t('dev.mapLede')}
        status={abnormal > 0 ? t('dev.mapAbnormal', { count: abnormal }) : undefined} />
      <div className="flex-1 p-4">
        {loading ? <Skeleton h={240} /> : bad ? (
          <ErrorState onRetry={() => { void devices.refetch(); void tags.refetch(); }} />
        ) : !site || (gateways.length === 0 && parked === 0 && equipment.length === 0) ? (
          <EmptyState title={t('dev.mapEmpty')} icon="search"
            action={<Link to="/infrastructure/add" className="text-blue hover:underline">{t('dev.add')}</Link>} />
        ) : (
          <div className="overflow-x-auto rounded-[5px] border border-line bg-paper p-3">
            <svg role="img" aria-label={t('dev.mapAria', { gateways: gateways.length, equipment: equipment.length })}
              viewBox={`0 0 900 ${height}`} className="w-full min-w-[720px]" style={{ height }}>
              {gateways.flatMap((g, gi) => equipment.flatMap((e, ei) => (links.has(`${g.d.id}|${e.key}`) ? [(
                <line key={`${g.d.id}-${e.key}`} x1={COL_X[1] + 70} y1={gy(gi, gwRows)}
                  x2={COL_X[2] - 10} y2={gy(ei, equipment.length)}
                  stroke="var(--color-line-hard)" strokeWidth={1}
                  strokeDasharray={g.state === 'online' ? undefined : '4 3'} opacity={0.7} />
              )] : [])))}
              {gateways.map((g, gi) => (
                <line key={g.d.id} x1={COL_X[0] + 60} y1={siteY} x2={COL_X[1] - 70} y2={gy(gi, gwRows)}
                  stroke="var(--color-line-hard)" strokeWidth={1.5}
                  strokeDasharray={g.state === 'online' ? undefined : '4 3'} />
              ))}

              <g>
                <rect x={COL_X[0] - 60} y={siteY - 24} width={120} height={48} rx={5} fill="var(--color-subtle)" stroke="var(--color-line-hard)" />
                <text x={COL_X[0]} y={siteY - 3} textAnchor="middle" fontSize={12} fontWeight={600} fill="currentColor">{site?.name}</text>
                <text x={COL_X[0]} y={siteY + 13} textAnchor="middle" fontSize={10} fill="currentColor" opacity={0.6}>{site?.code}</text>
              </g>

              {gateways.map((g, gi) => {
                const y = gy(gi, gwRows);
                const s = g.state as DeviceState;
                return (
                  <Link key={g.d.id} to={`/infrastructure?device=${g.d.id}`} aria-label={`${g.d.name}: ${t(`dev.state.${s}`)}`}>
                    <rect x={COL_X[1] - 70} y={y - 22} width={140} height={44} rx={5}
                      fill={s === 'online' ? 'var(--color-paper)' : s === 'stale' ? 'var(--color-caution-soft)' : s === 'offline' ? 'var(--color-danger-soft)' : 'var(--color-subtle)'}
                      stroke={s === 'online' ? 'var(--color-line-hard)' : s === 'stale' ? 'var(--color-caution)' : s === 'offline' ? 'var(--color-danger)' : 'var(--color-line-hard)'} />
                    <text x={COL_X[1] - 58} y={y - 3} fontSize={12} fontWeight={600} fill="currentColor">{STATE_STYLE[s].glyph} {g.d.name.slice(0, 16)}</text>
                    <text x={COL_X[1] - 58} y={y + 13} fontSize={10} fill="currentColor" opacity={0.7}>{t(`dev.state.${s}`)}{g.d.adapter ? ` · ${g.d.adapter}` : ''}</text>
                  </Link>
                );
              })}

              {parked > 0 && (
                <Link to="/infrastructure?status=disabled" aria-label={t('dev.mapParked', { count: parked })}>
                  <rect x={COL_X[1] - 70} y={gy(gateways.length, gwRows) - 22} width={140} height={44} rx={5}
                    fill="var(--color-subtle)" stroke="var(--color-line-hard)" strokeDasharray="4 3" />
                  <text x={COL_X[1] - 58} y={gy(gateways.length, gwRows) + 4} fontSize={12} fontWeight={600} fill="currentColor">
                    ○ {t('dev.mapParked', { count: parked })}
                  </text>
                </Link>
              )}

              {equipment.map((e, ei) => {
                const y = gy(ei, equipment.length);
                return (
                  <Link key={e.key} to={`/tags?q=${encodeURIComponent(e.key)}`} aria-label={`${e.key}: ${t(`dev.fresh_${e.fresh}`)}`}>
                    <rect x={COL_X[2] - 10} y={y - 22} width={200} height={44} rx={5} fill="var(--color-paper)" stroke={FRESH_STYLE[e.fresh]} strokeWidth={1.5} />
                    <text x={COL_X[2]} y={y - 3} fontSize={11} fontWeight={600} fill="currentColor">{FRESH_GLYPH[e.fresh]} {e.key.split(pathSep(e.key)).slice(-2).join(pathSep(e.key))}</text>
                    <text x={COL_X[2]} y={y + 13} fontSize={10} fill="currentColor" opacity={0.7}>
                      {t('dev.mapSignals', { count: e.signals.length })} · {t(`dev.fresh_${e.fresh}`)}
                    </text>
                  </Link>
                );
              })}

              {[t('dev.mapColSite'), t('dev.mapColGateway'), t('dev.mapColEquipment')].map((label, i) => (
                <text key={label} x={COL_X[i] + (i === 2 ? 90 : 0)} y={12} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--color-ink-68)">{label}</text>
              ))}
            </svg>
            <p className="mt-2 text-[11px] text-ink-46">{t('dev.mapNote')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
