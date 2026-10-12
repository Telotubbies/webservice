import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { api } from '../../lib/api';
import { live, STALE_MS } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { fmtAge } from '../../lib/format';
import { EQUIPMENT, T } from '../../lib/plant';
import { EmptyState } from '../../shared/ui/Feedback';
import { Icon } from '../../shared/ui/Icon';
import { normSeverity, SeverityBadge, StatePill } from '../../shared/ui/Status';
import { AlarmRows, useSignalLabel } from '../alarms/AlarmRows';
import { useAlarms } from '../alarms/alarms';
import { useFaceplate } from '../faceplate/FaceplateContext';
import { LineSchematic, useEquipmentAlarm } from '../line/LineSchematic';
import { InsightRail, useOpenInsights } from './InsightRail';
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

function EquipmentList() {
  const { t } = useTranslation();
  const now = useNow(1000);
  const run = useStore(() => live.latest.get(T.running));
  const runStale = !run || now - (Date.parse(run.ts) || 0) > STALE_MS;
  const alarms = {
    motor: useEquipmentAlarm('motor'), conveyor: useEquipmentAlarm('conveyor'),
    camera: useEquipmentAlarm('camera'), bin: useEquipmentAlarm('bin'),
  };
  return (
    <ul className="equip-list">
      {EQUIPMENT.map((e) => {
        const alarm = alarms[e.id];
        const state = e.id === 'motor' || e.id === 'conveyor'
          ? (runStale ? 'stale' : run?.v === true ? 'running' : 'stopped')
          : null;
        return (
          <li key={e.id}>
            <Link to={`/line?eq=${e.id}`} className="equip-link">
              <span className="equip-name">{t(e.labelKey)}</span>
              {alarm && <SeverityBadge severity={alarm} />}
              {state && <StatePill state={state} />}
              <Icon name="chevron" size={18} className="dim" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

const KIND_KEY = { anomaly: 'kindAnomaly', drift: 'kindDrift', flatline: 'kindFlatline', flapping: 'kindFlapping' } as const;

/** Insights mini-feed (§3.3-A.4): top 3 open insights — tag label, kind,
 *  score, age; clicking a row opens that tag's faceplate. */
function InsightFeed() {
  const { t } = useTranslation();
  const now = useNow(1000);
  const { openFaceplate } = useFaceplate();
  const label = useSignalLabel();
  const open = useOpenInsights();
  const top = open.slice(0, 3);

  return (
    <section className="panel insight-feed">
      <header className="panel-head">
        <h2>{t('overview.insightsFeed')}</h2>
        <span className="meta num">{open.length}</span>
        <div className="tools">
          <Link to="/insights" className="btn btn-sm btn-ghost">{t('insights.viewAll')}</Link>
        </div>
      </header>
      <div className="panel-body flush">
        {top.length === 0 ? (
          <p className="hint insight-feed-empty">{t('overview.noInsights')}</p>
        ) : (
          <ul className="insight-feed-list">
            {top.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  className="insight-row"
                  data-sev={normSeverity(i.severity)}
                  onClick={() => openFaceplate(i.tag)}
                >
                  <span className="chip-glyph" aria-hidden>✦</span>
                  <span className="insight-row-tag" title={i.tag}>{label(i.tag)}</span>
                  <span className="insight-row-kind">{t(`insights.${KIND_KEY[i.kind]}`)}</span>
                  <span className="num insight-row-score">{i.score.toFixed(1)}</span>
                  <span className="insight-row-age">{fmtAge(i.ts_start, now)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export function OverviewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const now = useNow(1000);
  const limits = useLimits();
  const { open } = useAlarms();

  return (
    <div className="page overview">
      <header className="page-head">
        <div>
          <h1>{t('overview.title')}</h1>
          <p className="lede">{t('overview.lede')}</p>
        </div>
        <div className="actions">
          <Link to="/line" className="btn">{t('overview.openLine')}</Link>
        </div>
      </header>

      <InsightRail />

      <section className="panel hero">
        <LineSchematic compact onSelect={(id) => navigate(`/line?eq=${id}`)} />
      </section>

      <section className="kpi-grid" aria-label={t('overview.title')}>
        {KPIS.map((name) => <MetricTile key={name} name={name} band={limits.get(name)} now={now} />)}
      </section>

      <div className="grid-2">
        <section className="panel">
          <header className="panel-head">
            <h2>{t('overview.activeAlarms')}</h2>
            <span className="meta num">{open.length}</span>
            <div className="tools"><Link to="/alarms" className="btn btn-sm btn-ghost">{t('shell.viewAlarms')}</Link></div>
          </header>
          <div className="panel-body flush">
            {open.length === 0
              ? <EmptyState title={t('overview.noActive')} body={t('overview.noActiveBody')} />
              : <AlarmRows alarms={open.slice(0, 6)} compact />}
          </div>
        </section>
        <div className="side-col">
          <section className="panel">
            <header className="panel-head"><h2>{t('overview.equipment')}</h2></header>
            <div className="panel-body flush"><EquipmentList /></div>
          </section>
          <InsightFeed />
        </div>
      </div>
    </div>
  );
}
