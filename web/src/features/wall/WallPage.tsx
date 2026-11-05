// Wallboard — read-only, dark, built to be read from across the room. It
// follows the same truth rule as the rest of the console: "all clear" only
// renders while the feed is open and the data is fresh; otherwise the whole
// board turns amber and says how old the data is.

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { live, STALE_MS } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { T, SIGNALS, formatSignal, unitOf } from '../../lib/plant';
import { fmtAge } from '../../lib/format';
import { useAlarms } from '../alarms/alarms';

const VALUES = [T.beltSpeed, T.beltTemp, T.binLevel] as const;

export function WallPage() {
  const { t, i18n } = useTranslation();
  const now = useNow();
  useStore(() => live.version);
  const ws = useStore(() => live.ws);
  const { active, critical } = useAlarms();
  const run = live.latest.get(T.running);
  const age = run ? now - Date.parse(run.ts) : Infinity;
  const blind = ws !== 'open' || !run || age > STALE_MS;
  const unacked = active.filter((a) => !a.acked_by);

  const word = blind ? t('linestatus.stale') : run.v ? t('linestatus.running') : t('linestatus.stopped');
  const field = blind
    ? 'bg-[#e0a100] text-black'
    : critical.length > 0 && unacked.length > 0 ? 'bg-[#c62828] text-white'
    : 'bg-[#14171a] text-white';

  return (
    <div className={`fixed inset-0 z-[100] flex flex-col gap-6 overflow-auto p-6 md:p-10 ${field}`} role="main">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-[clamp(2.5rem,9vw,6rem)] font-bold leading-none">{word}</h1>
        <div className="text-right">
          <div className="font-mono text-[clamp(1.5rem,4vw,3rem)] font-semibold tabular-nums">
            {new Date(now).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit', hour12: false })}
          </div>
          <Link to="/" className="text-[14px] underline opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2">{t('wall.exit')}</Link>
        </div>
      </div>

      <p className="text-[clamp(1.25rem,3vw,2rem)] font-semibold">
        {blind
          ? (run ? t('wall.staleSince', { age: fmtAge(run.ts, now) }) : t('wall.noData'))
          : active.length === 0 ? t('wall.clear') : t('linestatus.alarmsCount', { count: active.length })}
      </p>

      {!blind && active.length > 0 && (
        <ul className="flex flex-col gap-2 text-[clamp(1.1rem,2.4vw,1.75rem)]">
          {active.slice(0, 5).map((a) => (
            <li key={a.id} className="flex gap-3">
              <span className="font-semibold">{a.rule || a.tag}</span>
              <span className="opacity-70">{fmtAge(a.ts, now)}</span>
            </li>
          ))}
        </ul>
      )}

      <dl className="mt-auto grid grid-cols-1 gap-6 sm:grid-cols-3">
        {VALUES.map((tag) => {
          const tv = live.latest.get(tag);
          const ok = !blind && !!tv && now - Date.parse(tv.ts) <= STALE_MS;
          return (
            <div key={tag} className={ok ? '' : 'opacity-40'}>
              <dt className="text-[clamp(1rem,2vw,1.5rem)] opacity-80">{t(SIGNALS[tag]?.labelKey ?? tag)}</dt>
              <dd className="font-mono text-[clamp(2.5rem,7vw,4.5rem)] font-semibold leading-none tabular-nums">
                {ok ? formatSignal(tag, tv.v, i18n.language) : '—'}
                <span className="ml-2 text-[0.35em] font-normal opacity-70">{unitOf(tag)}</span>
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
