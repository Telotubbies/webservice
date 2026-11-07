// Alarm rule block of the tag flyout: write a rule, replay it against stored
// history to see how often it would have fired, save it; critical rules wait
// for a second person (the author cannot approve their own).

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi, ApiError, request, v2, type AdminRule } from '../../lib/api';
import { Notice } from '../../shared/ui/Feedback';
import { liveName } from '../../lib/plantModel';
import './i18n';

interface PendingRule extends AdminRule { mine: boolean }
interface Backtest { count: number; first: string[]; last: string | null; samples: number; hours: number; truncated: boolean }

const KINDS = ['hi', 'hihi', 'lo', 'lolo', 'stale'] as const;
const SEVS = ['info', 'warning', 'critical'] as const;
const HOURS = [24, 168, 720];

export const rulesApi = {
  backtest: (org: string, site: string, b: Record<string, unknown>) =>
    request<Backtest>(v2(org, `/sites/${site}/alarm-rules:backtest`), { method: 'POST', body: JSON.stringify(b) }),
  pending: (org: string, site: string) => request<{ items: PendingRule[] }>(v2(org, `/sites/${site}/alarm-rules/pending`)),
  decide: (org: string, site: string, id: string, what: 'approve' | 'reject') =>
    request<{ rule: AdminRule }>(v2(org, `/sites/${site}/alarm-rules/${id}/${what}`), { method: 'POST', body: '{}' }),
};

export function RuleSection({ orgId, siteId, tag, canEdit }: { orgId: string; siteId: string; tag: string; canEdit: boolean }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const tags = useQuery({ queryKey: ['admin-tags', orgId, siteId], queryFn: () => adminApi.siteTags(orgId, siteId) });
  const tagId = tags.data?.items.find((x) => liveName(x.path) === tag)?.id;
  const pending = useQuery({ queryKey: ['rules-pending', orgId, siteId], queryFn: () => rulesApi.pending(orgId, siteId) });
  const mine = (pending.data?.items ?? []).filter((r) => r.tag_id === tagId);

  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', kind: 'hi' as (typeof KINDS)[number], threshold: '', stale_s: '60', deadband: '0', severity: 'warning' as (typeof SEVS)[number], hours: 168 });
  const [res, setRes] = useState<Backtest | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error' | 'warn'; text: string } | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setRes(null); };

  const explain = (e: unknown) => e instanceof ApiError
    ? (e.status === 403 && /author/.test(e.message) ? t('rl.errAuthor') : e.status === 409 ? t('rl.errExists') : t('rl.errGeneric', { reason: e.message }))
    : t('rl.errGeneric', { reason: String(e) });

  const body = () => ({
    kind: f.kind, deadband: Number(f.deadband) || 0,
    ...(f.kind === 'stale' ? { stale_s: Number(f.stale_s) } : { threshold: Number(f.threshold) }),
  });
  const invalid = !tagId ? '' : !f.name.trim() ? t('rl.needName')
    : f.kind === 'stale' ? (!(Number(f.stale_s) >= 5 && Number(f.stale_s) <= 86400) ? t('rl.needStale') : '')
      : (f.threshold.trim() === '' || !Number.isFinite(Number(f.threshold)) ? t('rl.needThreshold') : '');

  const test = useMutation({
    mutationFn: () => rulesApi.backtest(orgId, siteId, { tag_id: tagId, hours: f.hours, ...body() }),
    onSuccess: (r) => { setRes(r); setMsg(null); },
    onError: (e) => { setRes(null); setMsg({ tone: 'error', text: explain(e) }); },
  });
  const save = useMutation({
    mutationFn: () => adminApi.createRule(orgId, siteId, { name: f.name.trim(), tag_id: tagId!, severity: f.severity, ...body() }),
    onSuccess: ({ rule }) => {
      setMsg({ tone: rule.severity === 'critical' ? 'warn' : 'ok', text: rule.severity === 'critical' ? t('rl.savedPending') : t('rl.saved') });
      setOpen(false); setRes(null);
      void qc.invalidateQueries({ queryKey: ['rules-pending'] });
      void qc.invalidateQueries({ queryKey: ['admin-rules'] });
      void qc.invalidateQueries({ queryKey: ['alarm-rules'] });
    },
    onError: (e) => setMsg({ tone: 'error', text: explain(e) }),
  });
  const decide = useMutation({
    mutationFn: (v: { id: string; what: 'approve' | 'reject' }) => rulesApi.decide(orgId, siteId, v.id, v.what),
    onSuccess: (_, v) => {
      setMsg({ tone: 'ok', text: v.what === 'approve' ? t('rl.approved') : t('rl.rejected') });
      void qc.invalidateQueries({ queryKey: ['rules-pending'] });
      void qc.invalidateQueries({ queryKey: ['admin-rules'] });
      void qc.invalidateQueries({ queryKey: ['alarm-rules'] });
    },
    onError: (e) => setMsg({ tone: 'error', text: explain(e) }),
  });

  if (!tagId) return null;
  const when = (iso: string) => new Date(iso).toLocaleString(i18n.language);
  return (
    <section aria-label={t('rl.title')} className="border-t border-line pt-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase text-ink-46">{t('rl.title')}</h3>
        {canEdit && !open && <button type="button" className="btn btn-sm" onClick={() => { setOpen(true); setMsg(null); }}>{t('rl.add')}</button>}
      </div>
      {!canEdit && <p className="text-[12px] text-ink-68">{t('rl.needAdmin')}</p>}
      {msg && <div className="mb-2"><Notice tone={msg.tone}>{msg.text}</Notice></div>}

      {mine.map((r) => (
        <div key={r.id} className="mb-2 rounded border border-line p-2 text-[12px]">
          <p className="font-semibold">{r.name} <span className="font-normal text-warn">· {t('rl.pending')}</span></p>
          <p className="text-ink-68">{t(`rl.kind_${r.kind}`, r.kind)} {r.threshold ?? r.stale_s} · {t(`rl.sev_${r.severity}`, r.severity)}</p>
          {r.mine ? <p className="mt-1 text-ink-68">{t('rl.pendingMine')}</p> : canEdit && (
            <div className="mt-1 flex gap-2">
              <button type="button" className="btn btn-sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, what: 'approve' })}>{t('rl.approve')}</button>
              <button type="button" className="btn btn-sm btn-ghost" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, what: 'reject' })}>{t('rl.reject')}</button>
            </div>
          )}
        </div>
      ))}

      {open && canEdit && (
        <div className="space-y-2 text-[13px]">
          <div>
            <label className="field-label" htmlFor="rl-name">{t('rl.name')}</label>
            <input id="rl-name" className="input h-8 w-full" value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="field-label" htmlFor="rl-kind">{t('rl.kind')}</label>
              <select id="rl-kind" className="input h-8 w-full" value={f.kind} onChange={(e) => set('kind', e.target.value as typeof f.kind)}>
                {KINDS.map((k) => <option key={k} value={k}>{t(`rl.kind_${k}`)}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="field-label" htmlFor="rl-sev">{t('rl.severity')}</label>
              <select id="rl-sev" className="input h-8 w-full" value={f.severity} onChange={(e) => setF((x) => ({ ...x, severity: e.target.value as typeof f.severity }))}>
                {SEVS.map((k) => <option key={k} value={k}>{t(`rl.sev_${k}`)}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            {f.kind === 'stale' ? (
              <div className="flex-1">
                <label className="field-label" htmlFor="rl-stale">{t('rl.staleS')}</label>
                <input id="rl-stale" inputMode="numeric" className="input h-8 w-full" value={f.stale_s} onChange={(e) => set('stale_s', e.target.value)} />
              </div>
            ) : (
              <>
                <div className="flex-1">
                  <label className="field-label" htmlFor="rl-th">{t('rl.threshold')}</label>
                  <input id="rl-th" inputMode="decimal" className="input h-8 w-full" value={f.threshold} onChange={(e) => set('threshold', e.target.value)} />
                </div>
                <div className="flex-1">
                  <label className="field-label" htmlFor="rl-db">{t('rl.deadband')}</label>
                  <input id="rl-db" inputMode="decimal" className="input h-8 w-full" value={f.deadband} onChange={(e) => set('deadband', e.target.value)} />
                </div>
              </>
            )}
            <div className="flex-1">
              <label className="field-label" htmlFor="rl-h">{t('rl.hours')}</label>
              <select id="rl-h" className="input h-8 w-full" value={f.hours} onChange={(e) => set('hours', Number(e.target.value))}>
                {HOURS.map((h) => <option key={h} value={h}>{t('rl.hoursOpt', { h })}</option>)}
              </select>
            </div>
          </div>

          <button type="button" className="btn btn-sm" disabled={!!invalid || test.isPending} onClick={() => test.mutate()}>{test.isPending ? t('rl.testing') : t('rl.test')}</button>
          {invalid && <p className="text-[12px] text-ink-46">{invalid}</p>}
          <div aria-live="polite">
            {res ? (
              <Notice tone={res.count > 0 ? 'warn' : 'ok'}>
                {res.count > 0 ? t('rl.result', { count: res.count, hours: res.hours, samples: res.samples }) : t('rl.resultNone', { hours: res.hours, samples: res.samples })}
                {res.last && <> {t('rl.resultLast', { when: when(res.last) })}</>}
                {res.truncated && <> {t('rl.resultTruncated')}</>}
              </Notice>
            ) : !invalid && <p className="text-[12px] text-ink-46">{t('rl.testFirst')}</p>}
          </div>
          {f.severity === 'critical' && <Notice tone="info">{t('rl.criticalNote')}</Notice>}
          <div className="flex gap-2">
            <button type="button" className="btn" disabled={!!invalid || save.isPending} onClick={() => save.mutate()}>{save.isPending ? t('rl.saving') : t('rl.save')}</button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>{t('rl.cancel')}</button>
          </div>
        </div>
      )}
    </section>
  );
}
