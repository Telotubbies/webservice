// Infrastructure → Devices: fleet list (status tiles, facets, table) over the
// real edges API, with rotate / disable per row and an "Add device" wizard.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, Power, Search, Server } from 'lucide-react';
import { adminApi, ApiError, type Device } from '../../lib/api';
import { useNow } from '../../lib/hooks';
import { fmtAge } from '../../lib/format';
import { canAdmin } from '../../app/session';
import { useAdminOrg, useAdminSite } from '../admin/admin';
import { Confirm } from '../../shared/ui/Confirm';
import { EmptyState, ErrorState, Notice, Skeleton } from '../../shared/ui/Feedback';
import { FacetGroup, ProductHeader, facetOptions, toggleIn } from '../../shared/ui/Product';
import { deviceState, STATE_STYLE, type DeviceState } from './devices';
import { SecretReveal } from './SecretReveal';

const STATES: DeviceState[] = ['online', 'stale', 'offline', 'never', 'disabled'];

export function DevicesPage() {
  const { t } = useTranslation();
  const now = useNow();
  const qc = useQueryClient();
  const { orgId, orgRole } = useAdminOrg();
  const { site } = useAdminSite(orgId);
  const admin = canAdmin(orgRole ?? 'none');
  const [q, setQ] = useState('');
  const [offState, setOffState] = useState<Set<string>>(new Set(['disabled']));
  const [offAdapter, setOffAdapter] = useState<Set<string>>(new Set());
  const [disabling, setDisabling] = useState<Device | null>(null);
  const [rotated, setRotated] = useState<{ device: Device; username: string; secret: string } | null>(null);
  const [err, setErr] = useState('');

  const key = ['devices', orgId, site?.id];
  const list = useQuery({
    queryKey: key,
    queryFn: () => adminApi.devices(orgId!, site!.id),
    enabled: !!orgId && !!site,
    refetchInterval: 10_000,
  });
  const rotate = useMutation({
    mutationFn: (d: Device) => adminApi.rotateDevice(orgId!, site!.id, d.id),
    onSuccess: (r, d) => { setRotated({ device: d, username: r.mqtt_username, secret: r.secret }); void qc.invalidateQueries({ queryKey: key }); },
    onError: (e) => setErr(String((e as Error).message)),
  });
  const disable = useMutation({
    mutationFn: (d: Device) => adminApi.disableDevice(orgId!, site!.id, d.id),
    onSuccess: () => { setDisabling(null); void qc.invalidateQueries({ queryKey: key }); },
    onError: (e) => { setDisabling(null); setErr(String((e as Error).message)); },
  });

  const rows = useMemo(
    () => (list.data?.items ?? []).map((d) => ({ ...d, state: deviceState(d, now), adapterKey: d.adapter ?? 'unknown' })),
    [list.data, now],
  );
  const shown = rows
    .filter((d) => !offState.has(d.state) && !offAdapter.has(d.adapterKey))
    .filter((d) => `${d.name} ${d.id} ${d.mqtt_username}`.toLowerCase().includes(q.toLowerCase()));
  const count = (s: DeviceState) => rows.filter((d) => d.state === s).length;

  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader icon="server" title={t('dev.product')} tabs={[{ to: '/infrastructure', label: t('dev.tabDevices'), end: true }]}
        actions={admin
          ? <Link to="/infrastructure/add" className="btn btn-sm"><Plus size={14} aria-hidden /> {t('dev.add')}</Link>
          : <span className="text-[11px] text-ink-46">{t('dev.needAdmin')}</span>} />

      <div className="border-b border-line bg-white px-4 py-2">
        <div className="relative">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-35" aria-hidden />
          <input className="input w-full pl-7" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('dev.searchPh')} aria-label={t('dev.searchPh')} />
        </div>
      </div>

      <div className="flex flex-1 gap-4 p-4">
        <aside className="w-[220px] shrink-0 self-start border border-line bg-white" aria-label={t('errtrack.facets')}>
          <FacetGroup title={t('dev.facetStatus')} off={offState} emptyLabel={t('slos.noValues')}
            onToggle={(v) => setOffState((s) => toggleIn(s, v))}
            options={facetOptions(rows, (d) => d.state, (v) => t(`dev.state.${v}`))} />
          <FacetGroup title={t('dev.facetAdapter')} off={offAdapter} emptyLabel={t('slos.noValues')}
            onToggle={(v) => setOffAdapter((s) => toggleIn(s, v))}
            options={facetOptions(rows, (d) => d.adapterKey, (v) => t(`dev.adapter.${v}`, { defaultValue: v }))} />
        </aside>

        <div className="min-w-0 flex-1">
          <div className="grid grid-cols-5 gap-2">
            {STATES.map((s) => (
              <div key={s} className={`rounded-[4px] px-3 py-2 ${s === 'never' || s === 'disabled' ? 'border border-line bg-white text-ink-68' : STATE_STYLE[s].pill}`}>
                <div className="text-[11px] font-semibold uppercase tracking-wide"><span aria-hidden>{STATE_STYLE[s].glyph} </span>{t(`dev.state.${s}`)}</div>
                <div className="mt-1 font-mono text-[22px] font-semibold">{count(s)}</div>
              </div>
            ))}
          </div>

          {err && <div className="mt-3"><Notice tone="error">{t('dev.actionFailed', { reason: err })}</Notice></div>}
          {rows.some((d) => d.needs_rotation && d.state !== 'disabled') && (
            <div className="mt-3"><Notice tone="warn">{t('dev.rotationNeeded')}</Notice></div>
          )}

          <section className="mt-3 overflow-x-auto rounded-[5px] border border-line bg-white">
            {list.isLoading || !site ? (
              <div className="space-y-2 p-3">{[0, 1, 2].map((i) => <Skeleton key={i} h={28} />)}</div>
            ) : list.isError ? (
              <ErrorState onRetry={() => void list.refetch()} detail={list.error instanceof ApiError && list.error.status === 403 ? t('dev.noAccess') : undefined} />
            ) : rows.length === 0 ? (
              <EmptyState title={t('dev.emptyTitle')} body={t('dev.emptyBody')} icon="plant"
                action={admin && <Link to="/infrastructure/add" className="btn btn-sm"><Plus size={14} aria-hidden /> {t('dev.add')}</Link>} />
            ) : shown.length === 0 ? (
              <EmptyState title={t('slos.empty')} icon="search" />
            ) : (
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left">
                    {['colStatus', 'colName', 'colAdapter', 'colHeartbeat', 'colClock', 'colCredential', 'colActions'].map((c) => (
                      <th key={c} scope="col" className="h-8 px-3 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-68">{t(`dev.${c}`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((d) => (
                    <tr key={d.id} className="h-12 border-b border-line last:border-0 hover:bg-info-soft">
                      <td className="px-3">
                        <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATE_STYLE[d.state].pill}`}>
                          <span aria-hidden>{STATE_STYLE[d.state].glyph}</span>{t(`dev.state.${d.state}`)}
                        </span>
                      </td>
                      <td className="px-3">
                        <div className="flex items-center gap-2 font-medium"><Server size={14} className="text-ink-46" aria-hidden />{d.name}</div>
                        <div className="font-mono text-[11px] text-ink-46">{d.id}</div>
                      </td>
                      <td className="px-3 text-[12px]">{t(`dev.adapter.${d.adapterKey}`, { defaultValue: d.adapterKey })}</td>
                      <td className="whitespace-nowrap px-3 text-[12px]">{d.last_hb_at ? fmtAge(d.last_hb_at, now) : t('dev.never')}</td>
                      <td className="px-3 text-[12px]">{d.clock_ok == null ? '—' : d.clock_ok ? `✓ ${t('dev.clockOk')}` : `▲ ${t('dev.clockBad')}`}</td>
                      <td className="px-3 text-[12px]">
                        <span className="font-mono">v{d.credential_version}</span>
                        {d.needs_rotation && d.state !== 'disabled' && <span className="ml-2 rounded bg-[var(--color-caution-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-[#8a5a00]">◆ {t('dev.rotateDue')}</span>}
                      </td>
                      <td className="px-3">
                        {admin && d.state !== 'disabled' && (
                          <span className="flex gap-1">
                            <button type="button" className="btn btn-sm btn-ghost whitespace-nowrap" disabled={rotate.isPending} onClick={() => { setErr(''); rotate.mutate(d); }}>
                              <KeyRound size={13} aria-hidden /> {t('dev.rotate')}
                            </button>
                            <button type="button" className="btn btn-sm btn-ghost whitespace-nowrap text-[var(--color-danger)]" onClick={() => { setErr(''); setDisabling(d); }}>
                              <Power size={13} aria-hidden /> {t('dev.disable')}
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>

      {disabling && (
        <Confirm title={t('dev.disableTitle', { name: disabling.name })} body={t('dev.disableBody')} confirm={t('dev.disable')} danger
          onNo={() => setDisabling(null)} onYes={() => disable.mutate(disabling)} />
      )}
      {rotated && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="rot-title">
          <div className="w-[560px] max-w-full rounded-[6px] bg-white p-4 shadow-pop">
            <h2 id="rot-title" className="mb-2 text-[15px] font-semibold">{t('dev.rotatedTitle', { name: rotated.device.name })}</h2>
            <SecretReveal username={rotated.username} secret={rotated.secret} />
            <p className="mt-3 text-[12px] text-ink-68">{t('dev.rotatedBody')}</p>
            <div className="mt-4 flex justify-end"><button type="button" className="btn btn-sm" autoFocus onClick={() => setRotated(null)}>{t('dev.savedIt')}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
