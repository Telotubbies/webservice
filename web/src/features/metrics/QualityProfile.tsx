// Tag quality profile (F15) — what share of stored samples arrived good,
// bad, uncertain or stale, as a 100% stacked bar + legend with counts.
// Good stays a quiet neutral (ISA-101: normal is not decorated); only the
// abnormal qualities carry hue, and each also carries its shape glyph and
// a text label, so the bar never relies on colour alone.

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '../../shared/ui/Feedback';
import { fetchRecent, fmtSpan, qualityCounts, ROW_CAP } from '../query/history';
import type { Quality } from '../../types';
import '../../shared/ui/explorerI18n';

const ORDER: Quality[] = ['good', 'uncertain', 'stale', 'bad'];
const FILL: Record<Quality, string> = {
  good: 'var(--color-line-hard)',
  uncertain: 'var(--color-caution)',
  stale: 'var(--color-ink-46)',
  bad: 'var(--color-danger)',
};
const GLYPH: Record<Quality, string> = { good: '●', uncertain: '◇', stale: '○', bad: '✚' };
const LABEL: Record<Quality, string> = { good: 'xp.qualGood', uncertain: 'xp.qualUncertain', stale: 'xp.qualStale', bad: 'xp.qualBad' };

export function useTagSamples(tag: string) {
  return useQuery({
    queryKey: ['tag-recent', tag],
    queryFn: () => fetchRecent(tag, ROW_CAP),
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: 1,
  });
}

export function QualityProfile({ tag }: { tag: string }) {
  const { t, i18n } = useTranslation();
  const q = useTagSamples(tag);

  if (q.isLoading) {
    return (
      <div className="quality-profile" role="status" aria-label={t('xp.qualLoading')}>
        <Skeleton h={10} />
        <Skeleton w="60%" h={10} />
      </div>
    );
  }
  if (q.isError || !q.data) {
    return <p className="quality-profile text-[12px] text-ink-68" role="alert">{t('xp.qualError')}</p>;
  }
  const pts = q.data.pts;
  if (!pts.length) return <p className="quality-profile text-[12px] text-ink-46">{t('qual.none')}</p>;

  const counts = qualityCounts(pts);
  const total = pts.length;
  const span = pts[pts.length - 1].t - pts[0].t;
  const pct = (n: number) => (n / total) * 100;
  const fmtPct = (n: number) => {
    const p = pct(n);
    if (n > 0 && p < 0.1) return '<0.1%';
    return `${p.toLocaleString(i18n.language.startsWith('th') ? 'th-TH' : 'en-GB', { maximumFractionDigits: p >= 99.95 || p < 10 ? 1 : 0 })}%`;
  };
  const shown = ORDER.filter((k) => counts[k] > 0);
  const summary = shown.map((k) => `${t(LABEL[k])} ${fmtPct(counts[k])}`).join(', ');

  return (
    <div className="quality-profile">
      <div
        className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-[3px]"
        role="img"
        aria-label={`${t('qual.title')}: ${summary}`}
      >
        {shown.map((k) => (
          <span
            key={k}
            data-q={k}
            className="h-full first:rounded-l-[3px] last:rounded-r-[3px]"
            style={{
              width: `${Math.max(pct(counts[k]), 0.6)}%`,
              background: k === 'stale'
                ? `repeating-linear-gradient(135deg, ${FILL.stale} 0 2px, transparent 2px 4px)`
                : FILL[k],
            }}
          />
        ))}
      </div>
      <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink-68">
        {ORDER.map((k) => (
          <li key={k} className={`flex items-center gap-1 ${counts[k] === 0 ? 'text-ink-46' : ''}`}>
            <span aria-hidden className="text-[9px]" style={{ color: counts[k] && k !== 'good' ? FILL[k] : undefined }}>{GLYPH[k]}</span>
            {t(LABEL[k])}
            <span className="font-mono font-semibold text-ink">{fmtPct(counts[k])}</span>
            <span className="font-mono text-ink-46">({counts[k].toLocaleString()})</span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[11px] text-ink-46">
        {t('xp.qualCoverage', { count: total, span: fmtSpan(span, i18n.language) })}
        {q.data.truncated && <> {t('xp.qualCapped')}</>}
      </p>
    </div>
  );
}
