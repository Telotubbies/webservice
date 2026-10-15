// Insights — dd Watchdog pattern: left facet panel (kind + state checkbox
// groups with counts and status dots), findings table on the right.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { live } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { fmtAge } from '../../lib/format';
import { SeverityBadge } from '../../shared/ui/Status';
import { PageBar, Card, Table } from '../../shared/ui/Page';
import { EmptyState, ErrorState, PageSkeleton } from '../../shared/ui/Feedback';
import { Icon } from '../../shared/ui/Icon';
import type { Insight } from '../../types';

const STATE_DOT: Record<string, string> = { open: '#d24f57', closed: '#828ba4' };

export function InsightsPage() {
  const { t } = useTranslation();
  const now = useNow();
  const insightRev = useStore(() => live.insightRev);
  const seedError = useStore(() => live.seedRev);
  /* Facets are modelled as EXCLUSION sets ("empty = everything shown").
   * The old inclusion model made the first uncheck select only that item —
   * with `kinds` starting empty (= all checked), clicking a checked row
   * produced a set containing just that kind, the opposite of the intent. */
  const [statesOff, setStatesOff] = useState<Set<string>>(new Set());
  const [kindsOff, setKindsOff] = useState<Set<string>>(new Set());
  const [fq, setFq] = useState('');

  const allKinds = useMemo(() => [...new Set(live.insights.map((i) => i.kind))], [insightRev]);
  const kindCount = (k: string) => live.insights.filter((i) => i.kind === k).length;
  const stateCount = (s: string) => live.insights.filter((i) => i.state === s).length;

  const rows = useMemo(() => {
    const needle = fq.trim().toLowerCase();
    return live.insights.filter((i) =>
      !statesOff.has(i.state) &&
      !kindsOff.has(i.kind) &&
      (!needle || i.tag.toLowerCase().includes(needle) || i.kind.toLowerCase().includes(needle)));
  }, [statesOff, kindsOff, fq, insightRev]);

  const toggle = (set: Set<string>, v: string, apply: (s: Set<string>) => void) =>
    apply(new Set(set.has(v) ? [...set].filter((x) => x !== v) : [...set, v]));

  const kindLabel = (k: Insight['kind']) =>
    t(`insights.kind${k[0].toUpperCase()}${k.slice(1)}`, { defaultValue: k });

  if (seedError && !live.insightsSeeded) {
    return <><PageBar title={t('insights.title')} /><ErrorState onRetry={() => window.location.reload()} /></>;
  }
  if (!live.insightsSeeded) {
    return <><PageBar title={t('insights.title')} /><PageSkeleton /></>;
  }

  const facet = (v: string, label: string, count: number, set: Set<string>, apply: (s: Set<string>) => void, dot?: string) => (
    <label key={v} className="flex h-7 cursor-pointer items-center gap-2 rounded px-2 text-[13px] text-ink-68 hover:bg-subtle has-[:focus-visible]:bg-subtle">
      <input type="checkbox" checked={!set.has(v)} onChange={() => toggle(set, v, apply)} className="accent-blue" aria-label={label} />
      {dot && <span className="h-2 w-2 rounded-full" style={{ background: dot }} />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="text-[11px] text-ink-46">{count}</span>
    </label>
  );

  return (
    <>
      <PageBar title={t('insights.title')} lede={t('insights.lede')} />
      {/* omnibar row */}
      <div className="border-b border-line bg-white px-4 py-2">
        <div className="relative">
          <Icon name="search" size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-35" />
          <input
            className="input w-full pl-7"
            placeholder={t('insights.filterPh')}
            aria-label={t('insights.filterPh')}
            value={fq}
            onChange={(e) => setFq(e.target.value)}
          />
        </div>
      </div>

      <div className="flex p-4">
        {/* facet panel — watchdog pattern */}
        <aside className="w-48 shrink-0 pr-3">
          <p className="px-2 pb-1 text-[11px] font-semibold uppercase text-ink-46">{t('insights.kind')}</p>
          {allKinds.map((k) => facet(k, kindLabel(k), kindCount(k), kindsOff, setKindsOff))}
          {!allKinds.length && <p className="px-2 text-[11px] italic text-ink-46">{t('insights.noMatch')}</p>}
          <p className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase text-ink-46">{t('insights.state')}</p>
          {facet('open', t('insights.open'), stateCount('open'), statesOff, setStatesOff, STATE_DOT.open)}
          {facet('closed', t('insights.closed'), stateCount('closed'), statesOff, setStatesOff, STATE_DOT.closed)}
        </aside>

        <div className="min-w-0 flex-1">
          <p className="pb-2 text-[12px] text-ink-46">{t('insights.count', { count: rows.length })}</p>
          <Card pad={false}>
            {rows.length === 0 ? (
              <EmptyState title={t('insights.empty')} body={t('insights.emptyBody')} icon="sparkle" />
            ) : (
              <Table head={[t('alarms.severity'), t('insights.kind'), t('control.tag'), t('insights.score'), t('alarms.colState'), t('alarms.colRaised'), t('insights.window')]}>
                {rows.map((i) => (
                  <tr key={i.id}>
                    <td><SeverityBadge severity={i.severity} /></td>
                    <td className="font-medium">{kindLabel(i.kind)}</td>
                    <td className="font-mono text-[12px]">{i.tag}</td>
                    <td className="font-mono text-[12px]">{i.score.toFixed(2)}</td>
                    <td>
                      <span className={`inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-semibold ${i.state === 'open' ? 'bg-[#fff4e0] text-[var(--color-caution)]' : 'bg-subtle text-ink-68'}`}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATE_DOT[i.state] ?? '#828ba4' }} />
                        {t(`insights.${i.state}`)}
                      </span>
                    </td>
                    <td className="text-[12px] text-ink-68">{fmtAge(i.ts_start, now)}</td>
                    <td className="text-[12px] text-ink-68">
                      {i.ts_end ? `${fmtAge(i.ts_end, now)}` : t('insights.ongoing')}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
