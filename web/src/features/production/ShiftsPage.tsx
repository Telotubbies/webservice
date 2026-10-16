// Shifts & machines admin — shift windows + breaks, non-working days, and
// the per-machine state/count/reject tag mapping with ideal cycle times
// (roadmap 5.1–5.3). Config writes need admin|owner; viewers see read-only.

import { useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../lib/api';
import { PageBar, PageBody, Card, Table } from '../../shared/ui/Page';
import { EmptyState, ErrorState, Notice, PermissionNotice, SkeletonRows } from '../../shared/ui/Feedback';
import { Confirm } from '../../shared/ui/Confirm';
import { useAdminOrg, useAdminSite, canAdmin } from '../admin/admin';
import { prodApi, type MachineRow, type Shift, type ShiftInput, type TagRef } from './api';
import './i18n';

const DOW = [1, 2, 3, 4, 5, 6, 7];

function parseBreaks(text: string): { start: string; end: string; name?: string }[] {
  // "12:00-13:00 lunch" per line; bad lines are dropped (form-level validation
  // keeps the authoritative check server-side).
  return text.split('\n').map((l) => l.trim()).filter(Boolean).flatMap((l) => {
    const m = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*(.*)$/.exec(l);
    return m ? [{ start: m[1], end: m[2], name: m[3] || '' }] : [];
  });
}
const breaksText = (s: Shift) => (s.breaks ?? []).map((b) => `${b.start}-${b.end} ${b.name ?? ''}`.trim()).join('\n');

export function ShiftsPage() {
  const { t } = useTranslation();
  const { orgId, orgRole } = useAdminOrg();
  const { site, sites, setSiteId } = useAdminSite(orgId);
  const canEdit = canAdmin(orgRole ?? 'none');
  const qc = useQueryClient();
  const dlg = useRef<HTMLDialogElement>(null);
  const [editing, setEditing] = useState<Shift | null>(null);
  const [delShift, setDelShift] = useState<Shift | null>(null);
  const [mapFor, setMapFor] = useState<MachineRow | null>(null);

  const shiftsQ = useQuery({
    queryKey: ['prod-shifts', orgId, site?.id],
    queryFn: () => prodApi.shifts(orgId!, site!.id), enabled: !!orgId && !!site,
  });
  const daysQ = useQuery({
    queryKey: ['prod-nwd', orgId, site?.id],
    queryFn: () => prodApi.nonworkingDays(orgId!, site!.id), enabled: !!orgId && !!site,
  });
  const machinesQ = useQuery({
    queryKey: ['prod-machines', orgId, site?.id],
    queryFn: () => prodApi.machines(orgId!, site!.id), enabled: !!orgId && !!site,
  });
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['prod-shifts', orgId, site?.id] });
    void qc.invalidateQueries({ queryKey: ['prod-nwd', orgId, site?.id] });
    void qc.invalidateQueries({ queryKey: ['prod-machines', orgId, site?.id] });
  };
  const saveShift = useMutation({
    mutationFn: (b: ShiftInput) =>
      editing ? prodApi.patchShift(orgId!, site!.id, editing.id, b) : prodApi.createShift(orgId!, site!.id, b),
    onSuccess: () => { done(); dlg.current?.close(); setEditing(null); },
  });
  const delShiftM = useMutation({
    mutationFn: (id: string) => prodApi.deleteShift(orgId!, site!.id, id),
    onSuccess: () => { done(); setDelShift(null); },
  });
  const addDay = useMutation({
    mutationFn: (b: { day: string; reason: string }) => prodApi.addNonworkingDay(orgId!, site!.id, b),
    onSuccess: done,
  });
  const delDay = useMutation({
    mutationFn: (day: string) => prodApi.delNonworkingDay(orgId!, site!.id, day),
    onSuccess: done,
  });
  const err = shiftsQ.error ?? daysQ.error ?? machinesQ.error ?? saveShift.error ?? delShiftM.error ?? addDay.error;
  const [newDay, setNewDay] = useState('');
  const [newReason, setNewReason] = useState('');

  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <PageBar icon="on-call" title={t('prod.shiftsTitle')} lede={t('prod.shiftsLede')}
        actions={sites.length > 1 ? (
          <select className="input h-8 w-auto text-[12px]" value={site?.id ?? ''}
            onChange={(e) => setSiteId(e.target.value)} aria-label={t('prod.machine')}>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        ) : undefined}
      />
      <PageBody>
        {!canEdit && <PermissionNotice role="admin">{t('prod.needConfig')}</PermissionNotice>}
        {err && <ErrorState detail={err instanceof ApiError ? err.message : undefined}
          onRetry={() => { void shiftsQ.refetch(); void daysQ.refetch(); void machinesQ.refetch(); }} />}

        <Card title={t('prod.shifts')}
          actions={canEdit && (
            <button type="button" className="btn btn-sm" onClick={() => { setEditing(null); dlg.current?.showModal(); }}>
              {t('prod.addShift')}
            </button>)}>
          {shiftsQ.isLoading ? <SkeletonRows rows={3} /> : (shiftsQ.data?.items.length ?? 0) === 0 ? (
            <EmptyState compact title={t('prod.noShifts')} body={t('prod.noShiftsHint')} />
          ) : (
            <div className="overflow-x-auto">
              <Table head={[t('prod.name'), t('prod.start'), t('prod.end'), t('prod.days'), t('prod.breaks'), t('prod.enabled'), '']}>
                {shiftsQ.data!.items.map((s) => (
                  <tr key={s.id}>
                    <td className="font-medium">{s.name}</td>
                    <td className="font-mono tabular-nums">{s.start_time}</td>
                    <td className="font-mono tabular-nums">{s.end_time}</td>
                    <td className="font-mono text-[12px] tabular-nums">{s.days_of_week.join(',') || '—'}</td>
                    <td className="font-mono text-[12px] tabular-nums">
                      {(s.breaks ?? []).map((b) => `${b.start}-${b.end}`).join(', ') || '—'}
                    </td>
                    <td>{s.enabled ? '✓' : '—'}</td>
                    <td className="whitespace-nowrap">
                      {canEdit && <>
                        <button type="button" className="btn btn-sm btn-ghost"
                          onClick={() => { setEditing(s); dlg.current?.showModal(); }}>{t('prod.edit')}</button>
                        <button type="button" className="btn btn-sm btn-ghost text-[var(--color-danger)]"
                          onClick={() => setDelShift(s)}>{t('prod.delete')}</button>
                      </>}
                    </td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </Card>

        <Card title={t('prod.calendar')}>
          {daysQ.isLoading ? <SkeletonRows rows={2} /> : (
            <>
              {(daysQ.data?.items.length ?? 0) === 0
                ? <EmptyState compact title={t('prod.noDays')} />
                : (
                  <ul className="space-y-1">
                    {daysQ.data!.items.map((d) => (
                      <li key={d.day} className="flex items-center gap-2 text-[13px]">
                        <span className="font-mono tabular-nums">{d.day}</span>
                        <span className="min-w-0 flex-1 truncate text-ink-68">{d.reason}</span>
                        {canEdit && (
                          <button type="button" className="btn btn-sm btn-ghost text-[var(--color-danger)]"
                            onClick={() => delDay.mutate(d.day)}>{t('prod.delete')}</button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              {canEdit && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                  <input type="date" className="input h-8 w-auto text-[12px]" value={newDay}
                    onChange={(e) => setNewDay(e.target.value)} aria-label={t('prod.day')} />
                  <input className="input h-8 min-w-0 flex-1 text-[12px]" value={newReason}
                    onChange={(e) => setNewReason(e.target.value)} placeholder={t('prod.reason')}
                    aria-label={t('prod.reason')} />
                  <button type="button" className="btn btn-sm" disabled={!newDay || addDay.isPending}
                    onClick={() => { addDay.mutate({ day: newDay, reason: newReason }); setNewDay(''); setNewReason(''); }}>
                    {t('prod.addDay')}
                  </button>
                </div>
              )}
            </>
          )}
        </Card>

        <Card title={t('prod.machines')}>
          {machinesQ.isLoading ? <SkeletonRows rows={3} /> : (machinesQ.data?.items.length ?? 0) === 0 ? (
            <EmptyState compact title={t('prod.noMachines')} body={t('prod.noMachinesHint')} />
          ) : (
            <div className="overflow-x-auto">
              <Table head={[t('prod.colMachine'), t('prod.colLine'), t('prod.configured'), '']}>
                {machinesQ.data!.items.map((mo) => (
                  <tr key={mo.device_id}>
                    <td className="font-medium">{mo.name}</td>
                    <td className="text-ink-68">{mo.line}</td>
                    <td>{mo.configured ? t('prod.configured') : t('prod.notConfigured')}</td>
                    <td>{canEdit && (
                      <button type="button" className="btn btn-sm btn-ghost"
                        onClick={() => setMapFor(mo)}>{t('prod.edit')}</button>
                    )}</td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </Card>
      </PageBody>

      <ShiftDialog key={editing?.id ?? 'new'} dlgRef={dlg} shift={editing}
        pending={saveShift.isPending} onSave={(b) => saveShift.mutate(b)} />
      {delShift && (
        <Confirm danger title={t('prod.deleteShiftTitle')}
          body={delShift.name} confirm={t('prod.delete')}
          onYes={() => delShiftM.mutate(delShift.id)} onNo={() => setDelShift(null)} />
      )}
      {mapFor && orgId && site && (
        <MapDialog org={orgId} site={site.id} machine={mapFor}
          tags={machinesQ.data?.tags ?? []} onClose={() => { setMapFor(null); done(); }} />
      )}
    </div>
  );
}

function ShiftDialog({ dlgRef, shift, pending, onSave }: {
  dlgRef: RefObject<HTMLDialogElement | null>;
  shift: Shift | null; pending: boolean; onSave: (b: ShiftInput) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(shift?.name ?? '');
  const [start, setStart] = useState(shift?.start_time ?? '08:00');
  const [end, setEnd] = useState(shift?.end_time ?? '16:00');
  const [days, setDays] = useState<number[]>(shift?.days_of_week ?? [1, 2, 3, 4, 5]);
  const [breaks, setBreaks] = useState(shift ? breaksText(shift) : '');
  const [enabled, setEnabled] = useState(shift?.enabled ?? true);
  const dow = t('prod.dow', { returnObjects: true }) as string[];
  const close = () => dlgRef.current?.close();

  return (
    <dialog ref={dlgRef}
      className="m-auto w-[min(480px,94vw)] rounded-[6px] border border-line p-0 shadow-pop backdrop:bg-black/40"
      aria-labelledby="sh-title">
      <form method="dialog" className="p-4" onSubmit={(e) => {
        e.preventDefault();
        onSave({ name: name.trim(), start_time: start, end_time: end, days_of_week: days, breaks: parseBreaks(breaks), enabled });
      }}>
        <h2 id="sh-title" className="mb-3 text-[15px] font-semibold">{shift ? t('prod.editShift') : t('prod.addShift')}</h2>
        <label className="block text-[12px] font-semibold text-ink-68" htmlFor="sh-name">{t('prod.name')}</label>
        <input id="sh-name" className="input mt-1 w-full" value={name} onChange={(e) => setName(e.target.value)} required />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] font-semibold text-ink-68" htmlFor="sh-start">{t('prod.start')}</label>
            <input id="sh-start" type="time" className="input mt-1 w-full" value={start} onChange={(e) => setStart(e.target.value)} required />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-ink-68" htmlFor="sh-end">{t('prod.end')}</label>
            <input id="sh-end" type="time" className="input mt-1 w-full" value={end} onChange={(e) => setEnd(e.target.value)} required />
          </div>
        </div>
        <fieldset className="mt-3">
          <legend className="text-[12px] font-semibold text-ink-68">{t('prod.days')}</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {DOW.map((d) => (
              <label key={d} className="flex items-center gap-1 text-[12px]">
                <input type="checkbox" checked={days.includes(d)}
                  onChange={(e) => setDays(e.target.checked ? [...days, d] : days.filter((x) => x !== d))} />
                {dow[d - 1] ?? d}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="mt-3 block text-[12px] font-semibold text-ink-68" htmlFor="sh-breaks">{t('prod.breaks')}</label>
        <textarea id="sh-breaks" className="input mt-1 w-full font-mono" rows={2} value={breaks}
          onChange={(e) => setBreaks(e.target.value)} placeholder={t('prod.breaksPh')} />
        <p className="mt-0.5 text-[11px] text-ink-46">{t('prod.breaksHint')}</p>
        <label className="mt-3 flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> {t('prod.enabled')}
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn btn-sm btn-ghost" onClick={close}>{t('prod.cancel')}</button>
          <button type="submit" className="btn btn-sm" disabled={pending || !name.trim() || start === end}>
            {t('prod.save')}
          </button>
        </div>
      </form>
    </dialog>
  );
}

const STATE_KEYS = ['running', 'idle', 'stopped', 'fault'] as const;
const parseVals = (s: string): unknown[] =>
  s.split(',').map((x) => x.trim()).filter(Boolean).map((x) => (Number.isNaN(Number(x)) ? x : Number(x)));
const valsText = (v: unknown[] | undefined) => (v ?? []).map(String).join(', ');

function MapDialog({ org, site, machine, tags, onClose }: {
  org: string; site: string; machine: MachineRow; tags: TagRef[]; onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const cur = useQuery({
    queryKey: ['prod-map', org, site, machine.device_id],
    queryFn: () => prodApi.stateMap(org, site, machine.device_id),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  });
  const prodsQ = useQuery({
    queryKey: ['prod-products', org, site, machine.device_id],
    queryFn: () => prodApi.products(org, site, machine.device_id),
  });
  const m = cur.data?.map;
  const [stateTag, setStateTag] = useState(m?.state_tag_id ?? '');
  const [countTag, setCountTag] = useState(m?.count_tag_id ?? '');
  const [rejectTag, setRejectTag] = useState(m?.reject_tag_id ?? '');
  const [threshold, setThreshold] = useState(m?.stop_threshold_s ?? 300);
  const [vals, setVals] = useState<Record<string, string>>(
    () => Object.fromEntries(STATE_KEYS.map((k) => [k, valsText(m?.states?.[k])])));
  const [loaded, setLoaded] = useState(false);
  if (m && !loaded) {  // hydrate once when the existing map lands
    setLoaded(true); setStateTag(m.state_tag_id); setCountTag(m.count_tag_id ?? '');
    setRejectTag(m.reject_tag_id ?? ''); setThreshold(m.stop_threshold_s);
    setVals(Object.fromEntries(STATE_KEYS.map((k) => [k, valsText(m.states?.[k])])));
  }
  const [prod, setProd] = useState('');
  const [cycle, setCycle] = useState('');

  const save = useMutation({
    mutationFn: () => prodApi.putStateMap(org, site, machine.device_id, {
      state_tag_id: stateTag,
      count_tag_id: countTag || null,
      reject_tag_id: rejectTag || null,
      states: Object.fromEntries(STATE_KEYS.map((k) => [k, parseVals(vals[k] ?? '')])),
      stop_threshold_s: threshold,
    }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['prod-map', org, site, machine.device_id] }),
  });
  const addProd = useMutation({
    mutationFn: () => prodApi.upsertProduct(org, site, machine.device_id,
      { product: prod.trim(), ideal_cycle_s: Number(cycle) }),
    onSuccess: () => { setProd(''); setCycle(''); void qc.invalidateQueries({ queryKey: ['prod-products', org, site, machine.device_id] }); },
  });
  const delProd = useMutation({
    mutationFn: (pid: string) => prodApi.deleteProduct(org, site, machine.device_id, pid),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['prod-products', org, site, machine.device_id] }),
  });

  const tagOpts = (v: string, set: (s: string) => void, label: string, allowNone = true) => (
    <>
      <label className="block text-[12px] font-semibold text-ink-68">{label}</label>
      <select className="input mt-1 w-full" value={v} onChange={(e) => set(e.target.value)} aria-label={label}>
        {allowNone && <option value="">{t('prod.none')}</option>}
        {tags.map((tg) => <option key={tg.id} value={tg.id}>{tg.path} — {tg.name}</option>)}
      </select>
    </>
  );

  return (
    <dialog open
      className="m-auto w-[min(560px,94vw)] rounded-[6px] border border-line p-0 shadow-pop backdrop:bg-black/40"
      aria-labelledby="map-title">
      <div className="p-4">
        <h2 id="map-title" className="mb-3 text-[15px] font-semibold">{machine.name}</h2>
        {cur.isLoading ? <SkeletonRows rows={4} /> : (
          <>
            {tags.length === 0 && <Notice tone="warn">{t('prod.noTags')}</Notice>}
            {tagOpts(stateTag, setStateTag, t('prod.stateTag'), false)}
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>{tagOpts(countTag, setCountTag, t('prod.countTag'))}</div>
              <div>{tagOpts(rejectTag, setRejectTag, t('prod.rejectTag'))}</div>
            </div>
            <fieldset className="mt-3">
              <legend className="text-[12px] font-semibold text-ink-68">{t('prod.stateValues')}</legend>
              <div className="mt-1 grid gap-2 sm:grid-cols-2">
                {STATE_KEYS.map((k) => (
                  <div key={k}>
                    <label className="block text-[11px] text-ink-68">{t(`prod.state_${k}`)}</label>
                    <input className="input mt-0.5 w-full font-mono text-[12px]" value={vals[k] ?? ''}
                      onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))}
                      placeholder={t('prod.valuesPh')} />
                  </div>
                ))}
              </div>
            </fieldset>
            <label className="mt-3 block text-[12px] font-semibold text-ink-68" htmlFor="map-th">{t('prod.stopThreshold')}</label>
            <input id="map-th" type="number" min={30} className="input mt-1 w-32" value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))} />
            {save.isError && <p className="mt-1 text-[11px] text-[var(--color-danger)]" role="alert">{t('prod.mapErr')}</p>}
            {save.isSuccess && <p className="mt-1 text-[11px] text-[var(--color-ok)]" role="status">{t('prod.mapSaved')}</p>}

            <h3 className="mt-4 border-t border-line pt-3 text-[13px] font-semibold">{t('prod.products')}</h3>
            {(prodsQ.data?.items ?? []).length > 0 && (
              <ul className="mt-1 space-y-1">
                {prodsQ.data!.items.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 text-[13px]">
                    <span className="flex-1">{p.product}</span>
                    <span className="font-mono tabular-nums">{p.ideal_cycle_s}s</span>
                    <button type="button" className="btn btn-sm btn-ghost text-[var(--color-danger)]"
                      onClick={() => delProd.mutate(p.id)}>{t('prod.delete')}</button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input className="input h-8 min-w-0 flex-1 text-[12px]" value={prod}
                onChange={(e) => setProd(e.target.value)} placeholder={t('prod.product')} aria-label={t('prod.product')} />
              <input type="number" min={0.001} step="any" className="input h-8 w-24 text-[12px]" value={cycle}
                onChange={(e) => setCycle(e.target.value)} placeholder={t('prod.cycleS')} aria-label={t('prod.cycleS')} />
              <button type="button" className="btn btn-sm" disabled={!prod.trim() || !Number(cycle) || addProd.isPending}
                onClick={() => addProd.mutate()}>{t('prod.addProduct')}</button>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>{t('prod.close')}</button>
              <button type="button" className="btn btn-sm" disabled={!stateTag || save.isPending}
                onClick={() => save.mutate()}>{t('prod.saveMap')}</button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
