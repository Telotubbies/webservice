import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { api } from '../../lib/api';
import { useNow, useStore } from '../../lib/hooks';
import { live } from '../../lib/live';
import { T } from '../../lib/plant';
import { EmptyState, ErrorState, Skeleton } from '../../shared/ui/Feedback';
import { AlarmRows } from '../alarms/AlarmRows';
import { useAlarms } from '../alarms/alarms';
import { LineSchematic } from '../line/LineSchematic';
import { AmbientField } from './AmbientField';
import { InsightRail } from './InsightRail';
import { MetricTile, type TileBand } from './MetricTile';
import './overview.css';

const KPIS = [T.beltSpeed, T.beltTemp, T.binLevel, T.gravel, T.speedSp];

/** Per-tag analog band edges from alarm rules: `hi` = min enabled hi/hihi
 *  threshold, `lo` = max enabled lo/lolo threshold (raw units). */
function useLimits() {
  const q = useQuery({ queryKey: ['alarm-rules'], queryFn: api.alarmRules, staleTime: 60_000 });
  const map = new Map<string, TileBand>();
  for (const r of q.data ?? []) {
    if (!r.tag || r.threshold == null || !r.enabled) continue;
    const band = map.get(r.tag) ?? {};
    if (r.kind === 'hi' || r.kind === 'hihi') {
      band.hi = band.hi === undefined ? r.threshold : Math.min(band.hi, r.threshold);
    } else if (r.kind === 'lo' || r.kind === 'lolo') {
      band.lo = band.lo === undefined ? r.threshold : Math.max(band.lo, r.threshold);
    } else {
      continue;
    }
    map.set(r.tag, band);
  }
  return map;
}

/** KPI tile placeholder — same vertical rhythm as a MetricTile so first
 *  load doesn't shift layout (v4 T12, skeletons not spinners). */
function TileSkeleton() {
  return (
    <article className="kpi tile-skel" aria-hidden>
      <header className="kpi-head"><Skeleton w="55%" h={14} /></header>
      <p className="kpi-value"><Skeleton w={96} h={32} /></p>
      <div className="kpi-band"><Skeleton h={10} /></div>
      <div className="kpi-spark"><Skeleton h={40} /></div>
    </article>
  );
}

export function OverviewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const now = useNow(1000);
  const limits = useLimits();
  const { open } = useAlarms();
  // cold-start: skeleton tiles/rows until the first REST seed lands —
  // a failed seed surfaces an error + retry instead (T12 review)
  useStore(() => live.tagRev);
  useStore(() => live.seedRev);
  const seeded = live.tagsSeeded;
  const alarmsSeeded = live.alarmsSeeded;
  const seedError = live.seedError;

  return (
    <>
      {/* ambient tier: live isobar field under everything (T11) */}
      <AmbientField />
      <div className="page overview">
        {/* context bar — the h1+lede collapsed to a single line (T11) */}
        <header className="context-bar">
          <h1 className="context-title">{t('overview.title')}</h1>
          <span className="context-sub">{t('overview.lede')}</span>
          <div className="context-actions">
            <Link to="/line" className="btn btn-sm">{t('overview.openLine')}</Link>
          </div>
        </header>

        <InsightRail />

        <section className="panel hero">
          <LineSchematic compact onSelect={(id) => navigate(`/line?eq=${id}`)} />
        </section>

        <section className="kpi-grid" aria-label={t('overview.title')}>
          {!seeded && seedError ? (
            <div style={{ gridColumn: '1 / -1' }}>
              <ErrorState onRetry={() => void api.tags().then((rows) => live.setTags(rows)).catch(() => live.setSeedError())} />
            </div>
          ) : !seeded ? (
            KPIS.map((name) => <TileSkeleton key={name} />)
          ) : (
            KPIS.map((name) => <MetricTile key={name} name={name} band={limits.get(name)} now={now} />)
          )}
        </section>

        {/* Equipment list and the insights mini-feed were cut (T11): the rail
            and the schematic already carry that state. What remains is the
            one foreground surface that matters — active alarms. */}
        <section className="panel">
          <header className="panel-head">
            <h2>{t('overview.activeAlarms')}</h2>
            <span className="meta num">{open.length}</span>
            <div className="tools"><Link to="/alarms" className="btn btn-sm btn-ghost">{t('shell.viewAlarms')}</Link></div>
          </header>
          <div className="panel-body flush">
            {!alarmsSeeded && seedError ? (
              <ErrorState onRetry={() => void api.alarms().then((a) => live.setAlarms(a)).catch(() => live.setSeedError())} />
            ) : !alarmsSeeded && open.length === 0 ? (
              <div className="panel-body" style={{ display: 'grid', gap: 12 }}>
                {[0, 1, 2].map((i) => <Skeleton key={i} h={28} />)}
              </div>
            ) : open.length === 0 ? (
              <EmptyState title={t('overview.noActive')} body={t('overview.noActiveBody')} />
            ) : (
              <AlarmRows alarms={open.slice(0, 6)} compact />
            )}
          </div>
        </section>
      </div>
    </>
  );
}
