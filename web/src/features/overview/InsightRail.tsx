// InsightRail — the AI layer's strip directly under the page head (spec
// §3.3-A): open insights as severity-sorted InsightChips plus a "View all"
// link to /insights. The rail element ALWAYS renders — with no open insights
// it collapses to a single calm empty line (not a celebration).

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { live } from '../../lib/live';
import { useStore } from '../../lib/hooks';
import { InsightChip } from '../../shared/ui/InsightChip';
import { normSeverity } from '../../shared/ui/Status';
import { useFaceplate } from '../faceplate/FaceplateContext';
import type { Insight } from '../../types';

const SEV_RANK = { critical: 0, warning: 1, info: 2 } as const;
const RAIL_MAX = 6;

/** Open insights, severity first then newest — shared by the rail, the
 *  overview mini-feed, and the tile .is-anomaly lookups. */
export function sortOpenInsights(list: Insight[]): Insight[] {
  return list
    .filter((i) => i.state === 'open')
    .sort((a, b) =>
      SEV_RANK[normSeverity(a.severity)] - SEV_RANK[normSeverity(b.severity)]
      || (Date.parse(b.ts_start) || 0) - (Date.parse(a.ts_start) || 0));
}

export function useOpenInsights(): Insight[] {
  const rev = useStore(() => live.insightRev);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => sortOpenInsights(live.insights), [rev]);
}

export function InsightRail() {
  const { t } = useTranslation();
  const { openFaceplate } = useFaceplate();
  const open = useOpenInsights();

  return (
    <section className="insight-rail" aria-label={t('insights.title')}>
      {open.length === 0 ? (
        <p className="insight-rail-empty">{t('insights.empty')}</p>
      ) : (
        <div className="insight-rail-track">
          {open.slice(0, RAIL_MAX).map((i) => (
            <InsightChip key={i.id} insight={i} onClick={() => openFaceplate(i.tag)} />
          ))}
        </div>
      )}
      <Link to="/insights" className="insight-rail-all">{t('insights.viewAll')}</Link>
    </section>
  );
}
