// Dev-only harness for the standard chart: synthetic loaders, no backend.
// Open /charts-preview.html on the dev server (?theme=dark&lng=th optional).

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans-thai/400.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';
import i18n from '../../lib/i18n';
import '../../index.css';
import { applyTheme } from '../../theme/theme';
import { StandardChart } from './StandardChart';
import { rowsToSamples, type BucketRow, type RawRow } from './shape';
import { pickSource } from './source';
import type { ChartHistory } from './useChartHistory';

const qs = new URLSearchParams(location.search);
applyTheme(qs.get('theme') === 'dark' ? 'dark' : 'light');
if (qs.get('lng')) void i18n.changeLanguage(qs.get('lng')!);

const NOW = Date.UTC(2026, 10, 5, 12, 0, 0);
const MIN = 60e3; const H = 3600e3; const D = 24 * H;
const base = (t: number, k: number) => 50 + 6 * Math.sin(t / (k * H)) + 2 * Math.sin(t / (k * 7e3));
const SPIKE = NOW - 3 * D - 2 * H;

/** Synthetic tag: raw 1 Hz-ish rows or rollup buckets, a one-second spike at
 *  SPIKE, a bad stretch and a dead-feed stretch inside the last half hour. */
async function load(tag: string, from: number, to: number): Promise<ChartHistory> {
  const k = tag === 'pressure' ? 3 : 1;
  const plan = pickSource(from, to, NOW);
  if (plan.source === 'raw') {
    const rows: RawRow[] = [];
    for (let t = from; t <= to; t += 5000) {
      if (t > NOW - 12 * MIN && t < NOW - 8 * MIN) continue; // dead feed
      const bad = t > NOW - 22 * MIN && t < NOW - 19 * MIN;
      rows.push({ ts: new Date(t).toISOString(), v: base(t, k) + (Math.abs(t - SPIKE) < 3000 ? 40 : 0), q: bad ? 'bad' : 'good' });
    }
    return { samples: rowsToSamples(rows), plan, truncated: false };
  }
  const b = plan.bucketS! * 1000;
  const rows: BucketRow[] = [];
  for (let t = Math.ceil(from / b) * b; t < to; t += b) {
    const mid = t + b / 2;
    const hit = SPIKE >= t && SPIKE < t + b;
    const avg = base(mid, k) + (hit ? 40 / plan.bucketS! : 0);
    rows.push({ ts: new Date(t).toISOString(), min: avg - 1.5, max: avg + 1.5 + (hit ? 40 : 0), avg, n: plan.bucketS! });
  }
  return { samples: rowsToSamples(rows), plan, truncated: false };
}

const qc = new QueryClient();
const lim = [{ v: 62, kind: 'hi', severity: 'warning' as const }, { v: 66, kind: 'hihi', severity: 'critical' as const }];

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <main className="mx-auto grid max-w-[980px] gap-4 bg-paper p-4">
        <StandardChart tag="temperature" label="Oven temperature" unit="°C" range={[NOW - 30 * MIN, NOW]} syncKey="live" load={load} limits={lim}
          events={[{ t: NOW - 5 * MIN, kind: 'alarm', severity: 'warning', label: 'High' }, { t: NOW - 26 * MIN, kind: 'command', label: 'Setpoint change' }]} />
        <StandardChart tag="pressure" label="Line pressure" unit="bar" range={[NOW - 30 * MIN, NOW]} syncKey="live" load={load} color="#0b9a9a" decimals={2} />
        <StandardChart tag="temperature" label="Oven temperature, 7 days" unit="°C" range={[NOW - 7 * D, NOW]} limits={lim} load={load} />
        <StandardChart tag="temperature" label="Oven temperature, 30 days" unit="°C" range={[NOW - 30 * D, NOW]} limits={lim} load={load} />
      </main>
    </QueryClientProvider>
  </StrictMode>,
);
