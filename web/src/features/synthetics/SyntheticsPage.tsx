// Heartbeat checks — one passing/failing check per signal (fresh, good-quality
// sample inside the stale window) plus the edge gateway heartbeats.

import { useTranslation } from 'react-i18next';
import { SIGNALS } from '../../lib/plant';
import { live, STALE_MS } from '../../lib/live';
import { fmtAge } from '../../lib/format';
import { useNow, useStore } from '../../lib/hooks';
import { EdgeFleetTable } from '../health/EdgeFleetTable';
import { ProductHeader } from '../../shared/ui/Product';
import '../misc/i18n';

type Check = 'ok' | 'stale' | 'bad' | 'none';
const GLYPH: Record<Check, string> = { ok: '●', stale: '◆', bad: '▲', none: '○' };

export function SyntheticsPage() {
  const { t } = useTranslation();
  const now = useNow();
  useStore(() => live.version);
  const rows = Object.keys(SIGNALS).map((tag) => {
    const tv = live.latest.get(tag);
    const status: Check = !tv ? 'none' : now - Date.parse(tv.ts) > STALE_MS ? 'stale' : tv.q === 'good' ? 'ok' : 'bad';
    return { tag, tv, status };
  });
  const n = (s: Check) => rows.filter((r) => r.status === s).length;
  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader icon="multi-heartbeat" title={t('px.synthetics.title')} />
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap gap-6 rounded-[5px] border border-line bg-white p-4 text-[12px] text-ink-68">
          {(['ok', 'stale', 'bad', 'none'] as const).map((s) => (
            <span key={s}><b className="block font-mono text-[22px] text-ink">{n(s)}</b><span aria-hidden>{GLYPH[s]}</span> {t(`px.synthetics.${s}`)}</span>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse rounded-[5px] border border-line bg-white text-[13px]">
            <thead>
              <tr className="border-b border-line text-left">
                {['colCheck', 'colStatus', 'colAge'].map((c) => (
                  <th key={c} scope="col" className="h-8 px-3 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-68">{t(`px.synthetics.${c}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.tag} className="h-9 border-b border-line last:border-0">
                  <td className="px-3 font-mono text-[12px]">{r.tag}</td>
                  <td className="px-3"><span aria-hidden>{GLYPH[r.status]}</span> {t(`px.synthetics.${r.status}`)}</td>
                  <td className="px-3 font-mono text-[12px] text-ink-68">{r.tv ? fmtAge(r.tv.ts, now) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h2 className="text-[13px] font-semibold">{t('px.synthetics.edges')}</h2>
        <EdgeFleetTable />
      </div>
    </div>
  );
}
