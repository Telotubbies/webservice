import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { api } from '../../lib/api';
import { live, STALE_MS } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { fmtAge } from '../../lib/format';
import { EQUIPMENT, SIGNALS, T, displayNumber, formatSignal } from '../../lib/plant';
import { EmptyState } from '../../shared/ui/Feedback';
import { Icon } from '../../shared/ui/Icon';
import { Sparkline } from '../../shared/ui/Sparkline';
import { QualityMark, SeverityBadge, StatePill } from '../../shared/ui/Status';
import { AlarmRows } from '../alarms/AlarmRows';
import { useAlarms } from '../alarms/alarms';
import { LineSchematic, useEquipmentAlarm } from '../line/LineSchematic';
import './overview.css';

const KPIS = [T.beltSpeed, T.beltTemp, T.binLevel, T.gravel, T.speedSp];

function useLimits() {
  const q = useQuery({ queryKey: ['alarm-rules'], queryFn: api.alarmRules, staleTime: 60_000 });
  const map = new Map<string, number>();
  for (const r of q.data ?? []) {
    if (r.tag && r.threshold != null && (r.kind === 'hi' || r.kind === 'hihi') && r.enabled) {
      const prev = map.get(r.tag);
      map.set(r.tag, prev === undefined ? r.threshold : Math.min(prev, r.threshold));
    }
  }
  return map;
}

function Kpi({ name, limit, now }: { name: string; limit?: number; now: number }) {
  const { t, i18n } = useTranslation();
  const v = useStore(() => live.latest.get(name));
  useStore(() => live.version);
  const meta = SIGNALS[name];
  const stale = !v || now - (Date.parse(v.ts) || 0) > STALE_MS;
  const num = typeof v?.v === 'number' ? displayNumber(name, v.v) : undefined;
  const [lo, hi] = meta.range ?? [0, 100];
  const pct = num === undefined ? 0 : Math.max(0, Math.min(100, ((num - lo) / (hi - lo)) * 100));
  const limitPct = limit === undefined ? undefined : ((limit - lo) / (hi - lo)) * 100;
  const inAlarm = live.alarms.some((a) => a.tag === name && a.state !== 'cleared');
  const scale = name === T.gravel ? 100 : 1;

  return (
    <article className={`kpi tile${stale ? ' is-stale' : ''}${inAlarm ? ' is-alarm' : ''}`} data-signal={name}>
      <header className="kpi-head">
        <h3>{t(meta.labelKey)}</h3>
        {meta.stub && <span className="badge badge-stub tile-stub-badge" title={t('overview.stubTitle')}>{t('overview.stub')}</span>}
        {inAlarm && <SeverityBadge severity="critical" />}
      </header>
      <p className="kpi-value tile-val">
        <span className="num">{stale ? '—' : formatSignal(name, v?.v, i18n.language)}</span>
        {meta.unit && <span className="kpi-unit">{meta.unit}</span>}
      </p>
      <div className="kpi-bar" aria-hidden>
        <span className="kpi-bar-fill" style={{ width: `${stale ? 0 : pct}%` }} />
        {limitPct !== undefined && limitPct >= 0 && limitPct <= 100 && (
          <span className="kpi-bar-limit" style={{ left: `${limitPct}%` }} />
        )}
      </div>
      <div className="kpi-spark"><Sparkline tag={name} limit={limit} scale={scale} /></div>
      <footer className="kpi-foot">
        <span>{v ? t('state.updated', { age: fmtAge(v.ts, now) }) : t('state.never')}</span>
        {limit !== undefined && <span>{t('overview.limit', { v: `${limit} ${meta.unit ?? ''}`.trim() })}</span>}
        <QualityMark q={v?.q} stale={stale && !!v} />
      </footer>
    </article>
  );
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

      <section className="panel hero">
        <LineSchematic compact onSelect={(id) => navigate(`/line?eq=${id}`)} />
      </section>

      <section className="kpi-grid" aria-label={t('overview.title')}>
        {KPIS.map((name) => <Kpi key={name} name={name} limit={limits.get(name)} now={now} />)}
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
        <section className="panel">
          <header className="panel-head"><h2>{t('overview.equipment')}</h2></header>
          <div className="panel-body flush"><EquipmentList /></div>
        </section>
      </div>
    </div>
  );
}
