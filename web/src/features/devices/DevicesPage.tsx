// Infrastructure → Devices: fleet list (status tiles, facets, table) over the
// real edges API, with rotate / disable per row and an "Add device" wizard.
// Rotate and disable both sit behind a Confirm that states the consequence,
// and both end with a visible outcome (new key dialog / success notice).

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, CircleCheck, KeyRound, Plus, Power, Search, Server, X } from 'lucide-react';
import { adminApi, ApiError, type Device } from '../../lib/api';
import { useNow } from '../../lib/hooks';
import { fmtAge } from '../../lib/format';
import { canAdmin } from '../../app/session';
import { useAdminOrg, useAdminSite } from '../admin/admin';
import { Confirm } from '../../shared/ui/Confirm';
import { EmptyState, ErrorState, Notice, Skeleton } from '../../shared/ui/Feedback';
import { FacetGroup, ProductHeader, facetOptions, toggleIn } from '../../shared/ui/Product';
import { actionError, CAUTION_TEXT_CLASS, deviceState, isAbnormal, matchDevice, OK_TEXT_CLASS, STATE_STYLE, type DeviceState } from './devices';
import { DeviceDetail, StatePill, type DeviceRow } from './DeviceDetail';
import { SecretReveal } from './SecretReveal';

const STATES: DeviceState[] = ['online', 'stale', 'offline', 'never', 'disabled'];
const DEFAULT_OFF = ['disabled'];

export function DevicesPage() {
  const { t } = useTranslation();
  const now = useNow();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { orgId, orgRole } = useAdminOrg();
  const { site } = useAdminSite(orgId);
  const admin = canAdmin(orgRole ?? 'none');
  const [q, setQ] = useState('');
  const [offState, setOffState] = useState<Set<string>>(new Set(DEFAULT_OFF));
  const [offAdapter, setOffAdapter] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<{ kind: 'rotate' | 'disable'; device: Device } | null>(null);
  const [rotated, setRotated] = useState<{ device: Device; username: string; secret: string; graceH: number } | null>(null);
  const [done, setDone] = useState('');
  const [err, setErr] = useState('');

  const key = ['devices', orgId, site?.id];
  const list = useQuery({
    queryKey: key,
    queryFn: () => adminApi.devices(orgId!, site!.id),
    enabled: !!orgId && !!site,
    refetchInterval: 10_000,
  });
  // buffered-message depth per edge for the detail panel (member-read)
  const health = useQuery({
    queryKey: ['site-health', orgId, site?.id],
    queryFn: () => adminApi.siteHealth(orgId!, site!.id),
    enabled: !!orgId && !!site && params.has('device'),
    refetchInterval: 10_000,
  });
  const rotate = useMutation({
    mutationFn: (d: Device) => adminApi.rotateDevice(orgId!, site!.id, d.id),
    onSuccess: (r, d) => {
      const grace = (r as { grace_s?: number }).grace_s ?? 86_400;
      setRotated({ device: d, username: r.mqtt_username, secret: r.secret, graceH: Math.round(grace / 3600) });
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => setErr(actionError(e, t)),
  });
  const disable = useMutation({
    mutationFn: (d: Device) => adminApi.disableDevice(orgId!, site!.id, d.id),
    onSuccess: (_r, d) => { setDone(t('dev.disabledOk', { name: d.name })); void qc.invalidateQueries({ queryKey: key }); },
    onError: (e) => setErr(actionError(e, t)),
  });

  const rows: DeviceRow[] = useMemo(
    () => (list.data?.items ?? []).map((d) => ({ ...d, state: deviceState(d, now), adapterKey: d.adapter ?? 'unknown' })),
    [list.data, now],
  );
  const shown = rows
    .filter((d) => !offState.has(d.state) && !offAdapter.has(d.adapterKey))
    .filter((d) => matchDevice(d, q));
  const count = (s: DeviceState) => rows.filter((d) => d.state === s).length;
  const filtered = q.trim() !== '' || offAdapter.size > 0 || [...offState].join() !== DEFAULT_OFF.join();
  const clearFilters = () => { setQ(''); setOffAdapter(new Set()); setOffState(new Set(DEFAULT_OFF)); };
  // a tile is a one-click "show only this state"; clicking it again resets
  const onlyState = (s: DeviceState) => offState.size === STATES.length - 1 && !offState.has(s);
  const toggleTile = (s: DeviceState) => setOffState(onlyState(s) ? new Set(DEFAULT_OFF) : new Set(STATES.filter((x) => x !== s)));

  const selId = params.get('device');
  const selected = selId ? rows.find((d) => d.id === selId) ?? null : null;
  const openDetail = (id: string) => setParams((p) => { p.set('device', id); return p; });
  const closeDetail = () => setParams((p) => { p.delete('device'); return p; }, { replace: true });
  const ask = (kind: 'rotate' | 'disable', device: Device) => { setErr(''); setDone(''); setConfirming({ kind, device }); };
  const busy = rotate.isPending || disable.isPending;

  const actions = (d: DeviceRow) => admin && d.state !== 'disabled' && (
    <span className="flex gap-1">
      <button type="button" className="btn btn-sm btn-ghost whitespace-nowrap" disabled={busy}
        aria-label={`${t('dev.rotate')} — ${d.name}`} onClick={() => ask('rotate', d)}>
        <KeyRound size={13} aria-hidden /> {t('dev.rotate')}
      </button>
      <button type="button" className="btn btn-sm btn-ghost whitespace-nowrap text-[var(--color-danger)]" disabled={busy}
        aria-label={`${t('dev.disable')} — ${d.name}`} onClick={() => ask('disable', d)}>
        <Power size={13} aria-hidden /> {t('dev.disable')}
      </button>
    </span>
  );
  const clock = (d: DeviceRow) => d.clock_ok == null
    ? <span className="text-ink-46">{t('dev.clockUnknown')}</span>
    : d.clock_ok ? <span>✓ {t('dev.clockOk')}</span> : <span className={CAUTION_TEXT_CLASS}>◆ {t('dev.clockBad')}</span>;
  const keyChip = (d: DeviceRow) => d.needs_rotation && d.state !== 'disabled' && (
    <span className={`ml-2 inline-flex items-center gap-1 whitespace-nowrap rounded border border-[var(--color-warn)] px-1.5 text-[11px] font-semibold ${CAUTION_TEXT_CLASS}`}
      title={t('dev.keyMissingTip')}>◆ {t('dev.keyMissing')}</span>
  );

  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader icon="server" title={t('dev.product')} tabs={[{ to: '/infrastructure', label: t('dev.tabDevices'), end: true }]}
        actions={admin
          ? <Link to="/infrastructure/add" className="btn btn-sm whitespace-nowrap"><Plus size={14} aria-hidden /> {t('dev.add')}</Link>
          : <span className="hidden text-[11px] text-ink-46 md:inline">{t('dev.needAdmin')}</span>} />

      <div className="border-b border-line bg-white px-4 py-2">
        <div className="relative">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-35" aria-hidden />
          <input className="input h-8 w-full pl-7" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('dev.searchHint')} aria-label={t('dev.searchPh')} />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 p-4 lg:flex-row">
        <aside className="w-full shrink-0 self-start border border-line bg-white lg:w-[220px]" aria-label={t('errtrack.facets')}>
          <FacetGroup title={t('dev.facetStatus')} off={offState} emptyLabel={t('slos.noValues')}
            onToggle={(v) => setOffState((s) => toggleIn(s, v))}
            options={facetOptions(rows, (d) => d.state, (v) => t(`dev.state.${v}`))} />
          <FacetGroup title={t('dev.facetAdapter')} off={offAdapter} emptyLabel={t('slos.noValues')}
            onToggle={(v) => setOffAdapter((s) => toggleIn(s, v))}
            options={facetOptions(rows, (d) => d.adapterKey, (v) => t(`dev.adapter.${v}`, { defaultValue: v }))} />
        </aside>

        <div className="min-w-0 flex-1">
          {/* status tiles: colour only when the count is abnormal AND non-zero */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
            {STATES.map((s) => {
              const n = count(s);
              const hot = isAbnormal(s) && n > 0;
              const on = onlyState(s);
              return (
                <button key={s} type="button" aria-pressed={on} onClick={() => toggleTile(s)}
                  title={t('dev.tileFilter', { state: t(`dev.state.${s}`) })}
                  className={`rounded-[4px] border px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-blue ${
                    hot ? STATE_STYLE[s].tile : s === 'online' && n > 0 ? `border-line bg-white ${OK_TEXT_CLASS}` : 'border-line bg-white text-ink-68'
                  } ${on ? 'ring-2 ring-blue' : 'hover:border-ink-35'}`}>
                  <span className="block text-[11px] font-semibold uppercase tracking-wide"><span aria-hidden>{STATE_STYLE[s].glyph} </span>{t(`dev.state.${s}`)}</span>
                  <span className={`mt-1 block font-mono text-[22px] font-semibold ${n === 0 ? 'text-ink-35' : ''}`}>{n}</span>
                </button>
              );
            })}
          </div>

          {done && (
            <div className={`mt-3 flex items-start gap-2 rounded bg-[var(--color-ok-soft)] px-3 py-2 text-[12.5px] ${OK_TEXT_CLASS}`} role="status">
              <CircleCheck size={16} className="mt-0.5 shrink-0" aria-hidden /><span className="flex-1">{done}</span>
              <button type="button" className="shrink-0" aria-label={t('common.close')} onClick={() => setDone('')}><X size={14} aria-hidden /></button>
            </div>
          )}
          {disable.isPending && <div className="mt-3"><Notice>{t('dev.disabling', { name: disable.variables?.name ?? '' })}</Notice></div>}
          {rotate.isPending && <div className="mt-3"><Notice>{t('dev.rotating', { name: rotate.variables?.name ?? '' })}</Notice></div>}
          {err && <div className="mt-3"><Notice tone="error">{err}</Notice></div>}
          {rows.some((d) => d.needs_rotation && d.state !== 'disabled') && (
            <div className="mt-3"><Notice tone="warn">{t('dev.rotationNeeded')}</Notice></div>
          )}

          {rows.length > 0 && (
            <div className="mt-3 flex items-center gap-3 text-[12px] text-ink-68">
              <span aria-live="polite">{t('dev.showing', { shown: shown.length, total: rows.length })}</span>
              {filtered && <button type="button" className="text-blue hover:underline" onClick={clearFilters}>{t('dev.clearFilters')}</button>}
            </div>
          )}

          <section className="mt-2 rounded-[5px] border border-line bg-white">
            {list.isLoading || !site ? (
              <div className="space-y-2 p-3">{[0, 1, 2].map((i) => <Skeleton key={i} h={28} />)}</div>
            ) : list.isError ? (
              <ErrorState onRetry={() => void list.refetch()} detail={list.error instanceof ApiError && list.error.status === 403 ? t('dev.noAccess') : undefined} />
            ) : rows.length === 0 ? (
              <EmptyState title={t('dev.emptyTitle')} body={t('dev.emptyBody')} icon="plant"
                action={admin && <Link to="/infrastructure/add" className="btn"><Plus size={14} aria-hidden /> {t('dev.add')}</Link>} />
            ) : shown.length === 0 ? (
              <EmptyState title={t('slos.empty')} icon="search"
                action={<button type="button" className="btn btn-ghost" onClick={clearFilters}>{t('dev.clearFilters')}</button>} />
            ) : (
              <>
                {/* phone: one card per device — a 7-column table can't fit 390px */}
                <ul className="divide-y divide-line md:hidden">
                  {shown.map((d) => (
                    <li key={d.id} className="px-3 py-3">
                      <button type="button" className="flex w-full items-start gap-2 text-left" onClick={() => openDetail(d.id)}
                        aria-label={t('dev.openDetails', { name: d.name })}>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2"><StatePill state={d.state} /><span className="font-medium">{d.name}</span></span>
                          <span className="mt-1 block text-[12px] text-ink-68">
                            {t(`dev.adapter.${d.adapterKey}`, { defaultValue: d.adapterKey })} · {t('dev.colHeartbeat')}: {d.last_hb_at ? fmtAge(d.last_hb_at, now) : t('dev.never')}
                          </span>
                          {keyChip(d) && <span className="mt-1 block">{keyChip(d)}</span>}
                        </span>
                        <ChevronRight size={16} className="mt-0.5 shrink-0 text-ink-35" aria-hidden />
                      </button>
                      {actions(d) && <div className="mt-2">{actions(d)}</div>}
                    </li>
                  ))}
                </ul>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full border-collapse text-[13px]">
                    <thead>
                      <tr className="border-b border-line text-left">
                        {['colStatus', 'colName', 'colAdapter', 'colHeartbeat', 'colClock', 'colCredential', 'colActions'].map((c) => (
                          <th key={c} scope="col" className="h-8 whitespace-nowrap px-3 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-68">{t(`dev.${c}`)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((d) => (
                        <tr key={d.id} className={`h-12 border-b border-line last:border-0 hover:bg-info-soft ${d.state === 'disabled' ? 'text-ink-46' : ''}`}>
                          <td className="px-3"><StatePill state={d.state} /></td>
                          <td className="px-3">
                            <button type="button" className="group flex items-center gap-2 text-left font-medium hover:text-blue" onClick={() => openDetail(d.id)}
                              title={t('dev.openDetails', { name: d.name })}>
                              <Server size={14} className="shrink-0 text-ink-46" aria-hidden /><span className="group-hover:underline">{d.name}</span>
                            </button>
                            <div className="max-w-[260px] truncate font-mono text-[11px] text-ink-46" title={d.id}>{d.id}</div>
                          </td>
                          <td className="whitespace-nowrap px-3 text-[12px]">{t(`dev.adapter.${d.adapterKey}`, { defaultValue: d.adapterKey })}</td>
                          <td className="whitespace-nowrap px-3 text-[12px]" title={d.last_hb_at ?? undefined}>{d.last_hb_at ? fmtAge(d.last_hb_at, now) : t('dev.never')}</td>
                          <td className="whitespace-nowrap px-3 text-[12px]">{clock(d)}</td>
                          <td className="whitespace-nowrap px-3 text-[12px]"><span className="font-mono">v{d.credential_version}</span>{keyChip(d)}</td>
                          <td className="px-3">{actions(d)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </div>
      </div>

      {selected && (
        <DeviceDetail d={selected} now={now} admin={admin} siteName={site?.name} busy={busy}
          buffer={health.data?.edges.find((e) => e.id === selected.id)?.buffer_depth}
          onClose={closeDetail} onRotate={() => ask('rotate', selected)} onDisable={() => ask('disable', selected)} />
      )}
      {confirming?.kind === 'rotate' && (
        <Confirm title={t('dev.rotateTitle', { name: confirming.device.name })} body={t('dev.rotateBody')} confirm={t('dev.rotateConfirm')} danger={false}
          onNo={() => setConfirming(null)} onYes={() => { rotate.mutate(confirming.device); setConfirming(null); }} />
      )}
      {confirming?.kind === 'disable' && (
        <Confirm title={t('dev.disableTitle', { name: confirming.device.name })} body={t('dev.disableBody')} confirm={t('dev.disableConfirm')} danger
          onNo={() => setConfirming(null)} onYes={() => { disable.mutate(confirming.device); setConfirming(null); }} />
      )}
      {rotated && (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-ink/30 p-4" role="dialog" aria-modal="true" aria-labelledby="rot-title">
          <div className="max-h-[calc(100svh-32px)] w-[560px] max-w-full overflow-y-auto rounded-[6px] border border-line bg-white p-4 shadow-flyout">
            <h2 id="rot-title" className="mb-3 text-[15px] font-semibold">{t('dev.rotatedTitle', { name: rotated.device.name })}</h2>
            <SecretReveal username={rotated.username} secret={rotated.secret} />
            <p className="mt-3 text-[12.5px] text-ink-68">{t('dev.rotatedGrace', { hours: rotated.graceH })}</p>
            <div className="mt-4 flex justify-end">
              <button type="button" className="btn" autoFocus onClick={() => {
                setDone(t('dev.rotatedDone', { name: rotated.device.name, hours: rotated.graceH }));
                setRotated(null);
              }}>{t('dev.savedIt')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
