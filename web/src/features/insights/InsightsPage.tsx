// InsightsPage — the AI feed (spec §3.3-C). Full history comes from
// GET /api/insights (open + closed, newest 200); live.insights (WS pushes)
// wins on id so open/close transitions appear instantly. Tag cell opens the
// tag faceplate (carry-over ruling: insight cards open the faceplate); the
// trailing link deep-links the tag into trends at 1h.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { api } from '../../lib/api';
import { live } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { fmtAge, fmtClock } from '../../lib/format';
import { EmptyState, ErrorState, Skeleton } from '../../shared/ui/Feedback';
import { Segmented } from '../../shared/ui/Segmented';
import { SeverityBadge, normSeverity } from '../../shared/ui/Status';
import { useSignalLabel } from '../alarms/AlarmRows';
import { useFaceplate } from '../faceplate/FaceplateContext';
import type { Insight } from '../../types';
import './insights.css';

type StateFilter = 'open' | 'closed' | 'all';
type KindFilter = 'all' | Insight['kind'];

const KIND_KEY = { anomaly: 'kindAnomaly', drift: 'kindDrift', flatline: 'kindFlatline', flapping: 'kindFlapping' } as const;
const KINDS = ['all', 'anomaly', 'drift', 'flatline', 'flapping'] as KindFilter[];

export function InsightsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const { openFaceplate } = useFaceplate();
  const label = useSignalLabel();
  const now = useNow(1000);
  const rev = useStore(() => live.insightRev);
  const q = useQuery({ queryKey: ['insights'], queryFn: () => api.insights(), staleTime: 30_000 });

  const state = (params.get('state') as StateFilter) || 'all';
  const kind = (params.get('kind') as KindFilter) || 'all';
  const set = (k: string, v: string, dflt: string) => {
    const next = new URLSearchParams(params);
    if (v === dflt) next.delete(k); else next.set(k, v);
    setParams(next, { replace: true });
  };

  // REST history merged with the live slice — live wins on id.
  const all = useMemo(() => {
    const map = new Map<string, Insight>();
    for (const i of q.data ?? []) map.set(i.id, i);
    for (const i of live.insights) map.set(i.id, i);
    return [...map.values()].sort(
      (a, b) => (Date.parse(b.ts_start) || 0) - (Date.parse(a.ts_start) || 0),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, rev]);

  const rows = all.filter((i) => (state === 'all' || i.state === state) && (kind === 'all' || i.kind === kind));
  const count = (s: StateFilter) => (s === 'all' ? all.length : all.filter((i) => i.state === s).length);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{t('insights.title')}</h1>
          <p className="lede">{t('insights.lede')}</p>
        </div>
      </header>
      <section className="panel insight-list">
        <div className="insight-filters">
          <Segmented<StateFilter>
            label={t('insights.state')} value={state} onChange={(v) => set('state', v, 'all')}
            options={(['open', 'closed', 'all'] as StateFilter[]).map((s) => ({
              value: s, label: `${t(`insights.${s}`)} ${count(s)}`,
            }))}
          />
          <Segmented<KindFilter>
            label={t('insights.kind')} value={kind} onChange={(v) => set('kind', v, 'all')}
            options={KINDS.map((k) => ({
              value: k, label: k === 'all' ? t('insights.all') : t(`insights.${KIND_KEY[k]}`),
            }))}
          />
        </div>
        <div className="panel-body flush">
          {all.length === 0 && q.isError ? (
            <ErrorState onRetry={() => void q.refetch()} />
          ) : all.length === 0 && q.isPending ? (
            <div className="panel-body" style={{ display: 'grid', gap: 12 }}>
              {[0, 1, 2].map((i) => <Skeleton key={i} h={28} />)}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState icon="sparkle" title={t('insights.empty')} body={t('insights.emptyBody')} />
          ) : (
            <table className="table insight-table">
              <thead>
                <tr>
                  <th scope="col">{t('insights.kind')}</th>
                  <th scope="col">{t('insights.tag')}</th>
                  <th scope="col">{t('insights.severity')}</th>
                  <th scope="col" className="num">{t('insights.score')}</th>
                  <th scope="col">{t('insights.window')}</th>
                  <th scope="col">{t('insights.state')}</th>
                  <th scope="col"><span className="sr-only">{t('insights.openInTrends')}</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id} className="insight-row" data-kind={i.kind} data-sev={normSeverity(i.severity)} data-state={i.state}>
                    <td><span className="insight-kind">{t(`insights.${KIND_KEY[i.kind]}`)}</span></td>
                    <td>
                      <button type="button" className="tag-link insight-tag" title={i.tag} onClick={() => openFaceplate(i.tag)}>
                        {label(i.tag)}
                      </button>
                    </td>
                    <td><SeverityBadge severity={i.severity} /></td>
                    <td className="num">{i.score.toFixed(1)}</td>
                    <td className="insight-window mono">
                      {fmtClock(i.ts_start)} → {i.ts_end ? fmtClock(i.ts_end) : '·'}
                      <span className="insight-age">{fmtAge(i.ts_start, now)}</span>
                    </td>
                    <td><span className={`insight-state is-${i.state}`}>{t(`insights.${i.state}`)}</span></td>
                    <td className="insight-action">
                      <Link className="insight-trend" to={`/trends?s=${encodeURIComponent(i.tag)}&w=1h`}>
                        {t('insights.openInTrends')}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
