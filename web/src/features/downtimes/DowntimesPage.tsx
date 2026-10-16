// Downtimes — scheduled maintenance windows that mute alarm rules for a
// scope. Facets (active / recurring), table, "Schedule downtime" dialog with
// inline validation, "End now" per active row.

import { useMemo, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, downtimeApi, type DowntimeInput } from '../../lib/api';
import { useAdminOrg } from '../admin/admin';
import { canOperate, useRole } from '../../app/session';
import { DdIcon } from '../../shared/ui/DdIcon';
import { EmptyState, Notice } from '../../shared/ui/Feedback';
import { FacetGroup, ProductHeader, facetOptions, toggleIn } from '../../shared/ui/Product';

interface Downtime {
  id: string; rule: string; description: string;
  start: number; end: number; recurring: boolean;
}
const H = 3600e3;

type State = 'active' | 'scheduled' | 'ended';
const stateOf = (d: Downtime, now: number): State => (now < d.start ? 'scheduled' : now < d.end ? 'active' : 'ended');
const STATE_STYLE: Record<State, string> = {
  active: 'bg-[#e6f0fb] text-[#0b5cad]',
  scheduled: 'bg-subtle text-ink-68',
  ended: 'bg-subtle text-ink-46',
};
const fmt = (ms: number) => new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
/** value for <input type="datetime-local"> in local time */
const local = (ms: number) => new Date(ms - new Date(ms).getTimezoneOffset() * 60e3).toISOString().slice(0, 16);

export function DowntimesPage() {
  const { t } = useTranslation();
  const role = useRole();
  const operable = canOperate(role);
  const { orgId } = useAdminOrg();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['downtimes', orgId], queryFn: () => downtimeApi.list(orgId!), enabled: !!orgId, refetchInterval: 30_000 });
  const rows = useMemo<Downtime[]>(() => (list.data?.downtimes ?? []).map((d) => ({
    id: d.id, rule: d.rule ?? '', description: d.description, start: Date.parse(d.starts_at),
    end: Date.parse(d.ends_at), recurring: d.recurring,
  })), [list.data]);
  const done = () => qc.invalidateQueries({ queryKey: ['downtimes', orgId] });
  const create = useMutation({ mutationFn: (b: DowntimeInput) => downtimeApi.create(orgId!, b), onSuccess: done });
  const end = useMutation({ mutationFn: (id: string) => downtimeApi.end(orgId!, id), onSuccess: done });
  const err = create.error ?? end.error ?? list.error;
  const [offState, setOffState] = useState<Set<string>>(new Set(['ended']));
  const [offRec, setOffRec] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const dlg = useRef<HTMLDialogElement>(null);
  const now = Date.now();

  const withState = useMemo(() => rows.map((d) => ({ ...d, state: stateOf(d, now), rec: String(d.recurring) })), [rows, now]);
  const shown = withState
    .filter((d) => !offState.has(d.state) && !offRec.has(d.rec))
    .filter((d) => `${d.rule} ${d.description}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.start - b.start);

  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader
        icon="monitor" title={t('downtime.product')}
        tabs={[{ to: '/admin/rules', label: t('downtime.tabRules') }, { to: '/downtimes', label: t('downtime.title') }]}
      />
      <div className="flex items-center gap-2 border-b border-line bg-white px-4 py-2">
        <input className="input flex-1 font-mono" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('downtime.queryPh')} aria-label={t('downtime.queryPh')} />
      </div>
      {err && <div className="px-4 pt-2"><Notice>{err instanceof ApiError && err.status === 403 ? t('downtime.needOperator') : t('downtime.failed')}</Notice></div>}

      <div className="flex flex-1 gap-4 p-4 pt-2">
        <aside className="w-[220px] shrink-0 self-start border border-line bg-white" aria-label={t('errtrack.facets')}>
          <FacetGroup title={t('downtime.facetState')} off={offState} emptyLabel={t('slos.noValues')}
            onToggle={(v) => setOffState((s) => toggleIn(s, v))}
            options={facetOptions(withState, (d) => d.state, (v) => t(`downtime.state.${v}`))} />
          <FacetGroup title={t('downtime.facetRecurring')} off={offRec} emptyLabel={t('slos.noValues')}
            onToggle={(v) => setOffRec((s) => toggleIn(s, v))}
            options={facetOptions(withState, (d) => d.rec, (v) => t(v === 'true' ? 'downtime.yes' : 'downtime.no'))} />
        </aside>

        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center">
            <span className="text-[12px] text-ink-68">{t('slos.showing', { shown: shown.length, total: rows.length })}</span>
            <span className="flex-1" />
            {operable ? (
              <button type="button" onClick={() => dlg.current?.showModal()}
                className="flex h-8 items-center gap-1.5 rounded border border-[var(--color-warn)] px-3 text-[13px] text-[#8a5a00] hover:bg-[var(--color-caution-soft)] focus-visible:outline-2 focus-visible:outline-blue">
                <DdIcon name="snooze" size={13} /> {t('downtime.schedule')}
              </button>
            ) : <span className="text-[11px] text-ink-46">{t('downtime.needOperator')}</span>}
          </div>

          <section className="overflow-x-auto rounded-[5px] border border-line bg-white">
            {shown.length === 0 ? <EmptyState title={t('slos.empty')} icon="search" /> : (
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left">
                    {['colStatus', 'colRecurring', 'colRule', 'colDesc', 'colStart', 'colEnd', 'colAction'].map((c) => (
                      <th key={c} scope="col" className="h-8 px-3 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-68">{t(`downtime.${c}`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((d) => (
                    <tr key={d.id} className="h-10 border-b border-line last:border-0 hover:bg-info-soft">
                      <td className="px-3"><span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATE_STYLE[d.state]}`}>{t(`downtime.state.${d.state}`)}</span></td>
                      <td className="px-3 text-[12px]">{d.recurring ? t('downtime.yes') : t('downtime.no')}</td>
                      <td className="px-3 font-medium">{d.rule || t('downtime.allRules')}</td>
                      <td className="px-3 text-ink-68">{d.description || '—'}</td>
                      <td className="whitespace-nowrap px-3 font-mono text-[12px]">{fmt(d.start)}</td>
                      <td className="whitespace-nowrap px-3 font-mono text-[12px]">{fmt(d.end)}</td>
                      <td className="px-3">
                        {operable && d.state === 'active' && (
                          <button type="button" className="btn btn-sm btn-ghost whitespace-nowrap" onClick={() => end.mutate(d.id)}>{t('downtime.endNow')}</button>
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

      <ScheduleDialog dlgRef={dlg} rules={list.data?.rules ?? []} onSave={(b) => create.mutate(b)} />
    </div>
  );
}

function ScheduleDialog({ dlgRef, rules, onSave }: {
  dlgRef: RefObject<HTMLDialogElement | null>;
  rules: { id: string; name: string }[];
  onSave: (d: DowntimeInput) => void;
}) {
  const { t } = useTranslation();
  const [rule, setRule] = useState('');
  const [start, setStart] = useState(() => local(Date.now()));
  const [end, setEnd] = useState(() => local(Date.now() + 2 * H));
  const [recurring, setRecurring] = useState(false);
  const [desc, setDesc] = useState('');
  const [tried, setTried] = useState(false);

  const errs = {
    end: !(Date.parse(end) > Date.parse(start)) ? t('downtime.errEnd') : '',
  };
  const valid = !errs.end;
  const close = () => { dlgRef.current?.close(); setTried(false); };

  return (
    <dialog ref={dlgRef} className="m-auto w-[480px] rounded-[6px] border border-line p-0 shadow-pop backdrop:bg-black/40" aria-labelledby="dt-title">
      <form
        method="dialog" className="p-4"
        onSubmit={(e) => {
          e.preventDefault();
          setTried(true);
          if (!valid) return;
          onSave({ rule_id: rule || null, description: desc.trim(), starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString(), recurring });
          close();
        }}
      >
        <h2 id="dt-title" className="mb-3 text-[15px] font-semibold">{t('downtime.schedule')}</h2>
        <label className="block text-[12px] font-semibold text-ink-68" htmlFor="dt-rule">{t('downtime.colRule')}</label>
        <select id="dt-rule" className="input mt-1 w-full" value={rule} onChange={(e) => setRule(e.target.value)}>
          <option value="">{t('downtime.allRules')}</option>
          {rules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] font-semibold text-ink-68" htmlFor="dt-start">{t('downtime.colStart')}</label>
            <input id="dt-start" type="datetime-local" className="input mt-1 w-full" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-ink-68" htmlFor="dt-end">{t('downtime.colEnd')}</label>
            <input id="dt-end" type="datetime-local" className="input mt-1 w-full" value={end} onChange={(e) => setEnd(e.target.value)} aria-invalid={tried && !!errs.end} />
          </div>
        </div>
        {tried && errs.end && <p className="mt-1 text-[11px] text-[var(--color-danger)]" role="alert">{errs.end}</p>}

        <label className="mt-3 flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} /> {t('downtime.recurringWeekly')}
        </label>
        <label className="mt-3 block text-[12px] font-semibold text-ink-68" htmlFor="dt-desc">{t('downtime.colDesc')}</label>
        <input id="dt-desc" className="input mt-1 w-full" value={desc} onChange={(e) => setDesc(e.target.value)} />

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn btn-sm btn-ghost" onClick={close}>{t('common.close')}</button>
          <button type="submit" className="btn btn-sm">{t('downtime.save')}</button>
        </div>
      </form>
    </dialog>
  );
}
