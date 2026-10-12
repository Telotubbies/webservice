// InsightChip — compact AI-layer marker for a backend-computed insight.
// The ✦ glyph marks the AI/insight layer (not a severity shape); severity
// rides on data-sev for callers that want to style on it. The chip's
// title/aria-label carries the localized kind so anomaly vs flatline chips
// are distinguishable to assistive tech and on hover.

import { useTranslation } from 'react-i18next';
import type { Insight } from '../../types';
import { shortTag } from '../../lib/format';

const KIND_KEY = { anomaly: 'kindAnomaly', drift: 'kindDrift', flatline: 'kindFlatline', flapping: 'kindFlapping' } as const;

export function InsightChip({ insight, onClick }: { insight: Insight; onClick?: () => void }) {
  const { t } = useTranslation();
  const kind = t(`insights.${KIND_KEY[insight.kind]}`);
  return (
    <button
      type="button"
      className="insight-chip"
      data-kind={insight.kind}
      data-sev={insight.severity}
      data-insight-id={insight.id}
      title={`${kind} — ${insight.tag}`}
      aria-label={`${kind} — ${insight.tag}`}
      onClick={onClick}
    >
      <span className="chip-glyph" aria-hidden>✦</span>
      <span className="chip-tag">{shortTag(insight.tag)}</span>
      <span className="chip-score num">{insight.score.toFixed(1)}</span>
    </button>
  );
}
