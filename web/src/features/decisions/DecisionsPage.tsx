// F10: compare options for a silo that is close to empty. Levels come from the
// tag-history API; every figure prints its formula. A person decides: Review
// opens a panel to record the choice and reason, and for "switch source" the
// F05 control sheet, which is the only way a command is ever sent.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tagQueryApi, type TagBucket } from '../../lib/api';
import { canOperate, useRole } from '../../app/session';
import { usePrimaryScope } from '../admin/admin';
import { PageBar, Card } from '../../shared/ui/Page';
import { Icon } from '../../shared/ui/Icon';
import { EmptyState, ErrorState, Notice, SkeletonRows } from '../../shared/ui/Feedback';
import { fmtDateTime } from '../../lib/format';
import { CommandSheet } from '../line/CommandSheet';
import { burnRate, compare, DEFAULT_LEAD_MIN, RESERVE_PCT, type Cover, type OptionKey, type Pt } from './compare';
import { decisionsApi } from './api';
import './i18n';

// shortcut: cement silos are hard-wired to silo1..4, upgrade when sites declare their own silo list
const SILOS = [1, 2, 3, 4];
const levelPath = (n: number) => `batch/cem/silo${n}/level_pct`;
const screwPath = (n: number) => `batch/cem/screw${n}/running`;
const WINDOW_MS = 2 * 3600e3;

function useLevels(org: string | null, site: string | null) {
  return useQuery({
    queryKey: ['f10-levels', org, site],
    enabled: !!org && !!site,
    refetchInterval: 60_000,
    queryFn: async () => {
      const to = Date.now();
      const res = await Promise.all(SILOS.map((n) => tagQueryApi.history(org!, site!, {
        tag: levelPath(n), from: new Date(to - WINDOW_MS).toISOString(), to: new Date(to).toISOString(),
        agg: 'avg', bucket_s: 60,
      })));
      return SILOS.map((id, i): { id: number; pts: Pt[] } => ({
        id,
        pts: (res[i].rows as TagBucket[]).filter((r) => r.avg != null).map((r) => ({ t: Date.parse(r.ts), v: r.avg as number })),
      }));
    },
  });
}

export function DecisionsPage() {
  const { t } = useTranslation();
  const { orgId, siteId } = usePrimaryScope();
  const operate = canOperate(useRole());
  const levels = useLevels(orgId, siteId);
  const [lead, setLead] = useState(DEFAULT_LEAD_MIN);
  const [pick, setPick] = useState<number | null>(null);
  const [review, setReview] = useState<OptionKey | null>(null);
  const [sheet, setSheet] = useState(false);

  const silos = useMemo(() => (levels.data ?? []).filter((s) => s.pts.length > 1).map((s) => ({
    id: s.id, level: s.pts[s.pts.length - 1].v, rate: burnRate(s.pts),
  })), [levels.data]);
  const lowest = silos.reduce<number | null>((m, s) => (m == null || s.level < (silos.find((x) => x.id === m)?.level ?? 101) ? s.id : m), null);
  const target = silos.find((s) => s.id === (pick ?? lowest));
  const others = silos.filter((s) => s.id !== target?.id);
  const covers = target ? compare(target, others, lead) : [];
  const switchTo = covers.find((c) => c.key === 'switch_source')?.via;

  return (
    <>
      <PageBar title={t('f10.title')} lede={t('f10.lede')} />
      <div className="mx-auto flex max-w-[1100px] flex-col gap-4 p-4">
        {levels.isLoading || !orgId ? <SkeletonRows rows={5} />
          : levels.isError ? <ErrorState onRetry={() => levels.refetch()} detail={t('f10.loadFailed')} />
          : !target ? <EmptyState title={t('f10.noData')} icon="trends" />
          : (
            <>
              <Card>
                <div className="flex flex-wrap items-end gap-4">
                  <label className="flex flex-col gap-1 text-[12px] text-ink-68">{t('f10.silo')}
                    <select className="input min-h-10" value={target.id} onChange={(e) => { setPick(Number(e.target.value)); setReview(null); setSheet(false); }}>
                      {silos.map((s) => <option key={s.id} value={s.id}>{t('f10.silo')} {s.id} ({s.level.toFixed(1)} %)</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-[12px] text-ink-68">{t('f10.lead')}
                    <input className="input min-h-10 w-28" type="number" min={5} max={720} value={lead}
                      onChange={(e) => setLead(Math.min(720, Math.max(5, Number(e.target.value) || DEFAULT_LEAD_MIN)))} />
                  </label>
                  <dl className="flex gap-6 text-[13px]">
                    <div><dt className="text-[12px] text-ink-68">{t('f10.now')}</dt><dd className="font-semibold tabular-nums">{target.level.toFixed(1)} %</dd></div>
                    <div><dt className="text-[12px] text-ink-68">{t('f10.burn')}</dt>
                      <dd className="font-semibold tabular-nums">{target.rate != null && target.rate > 0.01 ? t('f10.perHour', { v: target.rate.toFixed(1) }) : t('f10.noDraw')}</dd></div>
                    <div><dt className="text-[12px] text-ink-68">{t('f10.reserve')}</dt><dd className="font-semibold tabular-nums">{RESERVE_PCT} %</dd></div>
                  </dl>
                </div>
                <p className="mt-2 text-[12px] text-ink-68">{t('f10.formulaHead')}: <code>{t('f10.burnFormula')}</code></p>
              </Card>

              <OptionBars covers={covers} lead={lead} onReview={(k) => { setReview(k); setSheet(false); }} switchTo={switchTo} />

              {review && (
                <ReviewPanel
                  key={`${target.id}-${review}`} siloId={target.id} cover={covers.find((c) => c.key === review)!}
                  snapshot={{ level: target.level, rate: target.rate, lead_min: lead, reserve: RESERVE_PCT, covers }}
                  operate={operate} org={orgId} site={siteId!} switchTo={switchTo}
                  sheet={sheet} onSheet={setSheet} onClose={() => { setReview(null); setSheet(false); }}
                />
              )}
              {sheet && review === 'switch_source' && switchTo != null && (
                <CommandSheet pending={{ tag: screwPath(switchTo), value: true, kind: 'start' }} title={t('f10.screwTitle', { n: switchTo })} expect={t('f10.screwExpect', { n: switchTo })} onClose={() => setSheet(false)} />
              )}
              <History org={orgId} site={siteId!} silo={target.id} />
            </>
          )}
      </div>
    </>
  );
}

/** One bar per option: hours of cover (single hue, length = size), the tanker
 *  lead time as a vertical mark, and an icon + word for the verdict. */
function OptionBars({ covers, lead, onReview, switchTo }: {
  covers: Cover[]; lead: number; onReview: (k: OptionKey) => void; switchTo?: number;
}) {
  const { t } = useTranslation();
  const leadH = lead / 60;
  const max = Math.max(leadH * 1.5, ...covers.map((c) => c.hours ?? 0)) * 1.1;
  return (
    <Card title={t('f10.title')}>
      <ul className="flex flex-col gap-4">
        {covers.map((c) => (
          <li key={c.key} className="grid min-w-0 gap-1 md:grid-cols-[200px_1fr_auto] md:items-center md:gap-4" data-testid={`opt-${c.key}`}>
            <div>
              <div className="text-[14px] font-semibold">{t(`f10.opt_${c.key}`)}</div>
              <div className="text-[12px] text-ink-68">
                {c.key === 'switch_source' ? (switchTo != null ? t('f10.desc_switch_source', { n: switchTo }) : t('f10.desc_switch_none')) : t(`f10.desc_${c.key}`)}
              </div>
            </div>
            <div className="min-w-0">
              <div className="relative h-4 rounded-[2px] bg-subtle" role="img"
                aria-label={`${t(`f10.opt_${c.key}`)}: ${c.hours != null ? t('f10.hours', { v: c.hours.toFixed(1) }) : '–'}`}>
                {c.hours != null && <div className="h-full rounded-[2px] bg-[var(--color-accent)]" style={{ width: `${Math.min(100, (c.hours / max) * 100)}%` }} />}
                <div className="absolute inset-y-[-3px] w-0.5 bg-ink" style={{ left: `${(leadH / max) * 100}%` }} title={t('f10.leadMark')} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[12px]">
                <span className={`inline-flex items-center gap-1 font-semibold ${c.ok ? 'text-[var(--color-ok-ink)]' : 'text-[var(--color-caution-ink)]'}`}>
                  <Icon name={c.ok ? 'check' : 'warn'} size={12} />{c.ok ? t('f10.ok') : t('f10.tight')}
                </span>
                <span className="tabular-nums">{c.hours != null ? t('f10.hours', { v: c.hours.toFixed(1) }) : '–'}</span>
                <code className="text-ink-68" data-testid={`formula-${c.key}`}>{c.formula.sym} → {c.formula.num}</code>
              </div>
            </div>
            <button type="button" className="btn min-h-10 justify-center" onClick={() => onReview(c.key)}>{t('f10.review')}</button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12px] text-ink-68">{t('f10.leadMark')}: {lead} min</p>
    </Card>
  );
}

function ReviewPanel({ siloId, cover, snapshot, operate, org, site, switchTo, sheet, onSheet, onClose }: {
  siloId: number; cover: Cover; snapshot: Record<string, unknown>; operate: boolean;
  org: string; site: string; switchTo?: number; sheet: boolean; onSheet: (v: boolean) => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [need, setNeed] = useState(false);
  const save = useMutation({
    mutationFn: () => decisionsApi.record(org, site, { subject: levelPath(siloId), option_key: cover.key, reason: reason.trim(), snapshot }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['f10-history'] }),
  });
  const submit = () => {
    if (reason.trim().length < 3) { setNeed(true); return; }
    setNeed(false); save.mutate();
  };
  return (
    <section className="rounded border border-line-hard bg-paper" aria-labelledby="f10-review" data-testid="decision-review">
      <h3 id="f10-review" className="border-b border-line px-3 py-2 text-[15px] font-semibold">{t('f10.reviewing', { name: t(`f10.opt_${cover.key}`) })}</h3>
      <div className="flex flex-col gap-3 px-3 py-3">
        <code className="text-[12px] text-ink-68">{cover.formula.sym} → {cover.formula.num}</code>
        <p className="text-[13px]">{t('f10.humanNote')}</p>
        {!operate ? <Notice tone="info">{t('f10.viewerOnly')}</Notice> : (
          <>
            <label className="flex flex-col gap-1 text-[13px] font-semibold">{t('f10.reason')}
              <textarea className="input min-h-20 font-normal" maxLength={500} value={reason} placeholder={t('f10.reasonPlaceholder')}
                aria-invalid={need} onChange={(e) => { setReason(e.target.value); if (e.target.value.trim().length >= 3) setNeed(false); }} />
            </label>
            {need && <p role="alert" className="text-[12px] text-[var(--color-danger)]">{t('f10.reasonRequired')}</p>}
            {save.isError && <p role="alert" className="text-[12px] text-[var(--color-danger)]">{t('f10.recordFailed')}</p>}
            {save.isSuccess && <p role="status" className="text-[12px] text-[var(--color-ok-ink)]">{t('f10.recorded')}</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn min-h-10 justify-center" disabled={save.isPending || save.isSuccess} onClick={submit}>
                {save.isPending ? t('f10.recording') : t('f10.record')}
              </button>
              {cover.key === 'switch_source' && switchTo != null && !sheet && (
                <button type="button" className="btn btn-ghost min-h-10 justify-center" onClick={() => onSheet(true)}>{t('f10.openSheet')}</button>
              )}
              <button type="button" className="btn btn-ghost min-h-10 justify-center" onClick={onClose}>{t('f10.close')}</button>
            </div>
            {cover.key === 'switch_source' && switchTo != null && <p className="text-[12px] text-ink-68">{t('f10.sheetHint', { n: switchTo })}</p>}
          </>
        )}
      </div>
    </section>
  );
}

function History({ org, site, silo }: { org: string; site: string; silo: number }) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['f10-history', org, site, silo], queryFn: () => decisionsApi.list(org, site, levelPath(silo)) });
  return (
    <Card title={t('f10.history')}>
      {!q.data?.items.length ? <p className="text-[13px] text-ink-68">{t('f10.historyEmpty')}</p> : (
        <ul className="flex flex-col gap-2">
          {q.data.items.map((d) => (
            <li key={d.id} className="text-[13px]">
              <span className="font-semibold">{t(`f10.opt_${d.option_key}`)}</span>{' '}
              <span className="text-ink-68">{fmtDateTime(d.decided_at)}</span>
              <div>{d.reason}</div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
