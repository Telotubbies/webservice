// InsightRail — the AI layer's strip directly under the page head (spec
// §3.3-A): open insights as severity-sorted InsightChips plus a "View all"
// link to /insights. The rail element ALWAYS renders — with no open insights
// it collapses to a single calm empty line (not a celebration).

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../../lib/api';
import { live } from '../../lib/live';
import { useStore } from '../../lib/hooks';
import { ErrorState, Skeleton } from '../../shared/ui/Feedback';
import { InsightChip } from '../../shared/ui/InsightChip';
import { normSeverity } from '../../shared/ui/Status';
import { useFaceplate } from '../faceplate/FaceplateContext';
import type { Insight } from '../../types';

const SEV_RANK = { critical: 0, warning: 1, info: 2 } as const;
const RAIL_MAX = 6;

/** Open insights, severity first then newest — shared by the rail and the
 *  tile .is-anomaly lookups. (The overview mini-feed was cut in v4 T11.) */
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
  // consume the insights seed flags (T12 review — the flag was dead):
  // pre-seed = skeleton chips, failed seed = error + retry, never a lie
  // that the plant has "no insights" while the seed is still in flight.
  useStore(() => live.seedRev);
  const seeded = live.insightsSeeded;
  const seedError = live.seedError;
  const trackRef = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, number>());

  // FLIP reorder (v4 T12): chips re-sort by severity as insights open/close —
  // surviving chips glide to their new slot on --dur-state instead of
  // teleporting. WAAPI, keyed on data-insight-id; skipped for reduced motion.
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const prev = positions.current;
    const next = new Map<string, number>();
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const chip of Array.from(track.querySelectorAll<HTMLElement>('[data-insight-id]'))) {
      const id = chip.dataset.insightId!;
      const x = chip.offsetLeft;
      next.set(id, x);
      const p = prev.get(id);
      if (!calm && p !== undefined && p !== x) {
        chip.animate(
          [{ transform: `translateX(${p - x}px)` }, { transform: 'translateX(0)' }],
          { duration: 300, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
        );
      }
    }
    positions.current = next;
  }, [open]);

  return (
    <section className="insight-rail" aria-label={t('insights.title')}>
      {!seeded && seedError ? (
        <ErrorState
          onRetry={() => void api.insights({ state: 'open' }).then((a) => live.setInsights(a)).catch(() => live.setSeedError())}
        />
      ) : !seeded ? (
        <div className="insight-rail-track" aria-hidden>
          {[0, 1].map((i) => <Skeleton key={i} w={220} h={40} />)}
        </div>
      ) : open.length === 0 ? (
        <p className="insight-rail-empty">{t('insights.empty')}</p>
      ) : (
        <div className="insight-rail-track" ref={trackRef}>
          {open.slice(0, RAIL_MAX).map((i) => (
            <InsightChip key={i.id} insight={i} onClick={() => openFaceplate(i.tag)} />
          ))}
        </div>
      )}
      <Link to="/insights" className="insight-rail-all">{t('insights.viewAll')}</Link>
    </section>
  );
}
