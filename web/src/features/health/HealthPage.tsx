// Data path PLC → edge → broker → backend → database → this browser, each hop
// with its own status, so a fault is located at a glance.

import { useTranslation } from 'react-i18next';
import { live } from '../../lib/live';
import { useStore } from '../../lib/hooks';
import { fmtClock, fmtUptime } from '../../lib/format';
import { Icon } from '../../shared/ui/Icon';
import './health.css';

type Tone = 'ok' | 'bad' | 'warn' | 'unknown';

function Hop({ title, tone, status, rows }: {
  title: string; tone: Tone; status: string; rows?: [string, string][];
}) {
  return (
    <li className={`hop is-${tone}`}>
      <span className="hop-node" aria-hidden>
        <Icon name={tone === 'ok' ? 'check' : tone === 'unknown' ? 'info' : 'warn'} size={18} />
      </span>
      <div className="hop-body">
        <h3>{title}</h3>
        <p className="hop-status">{status}</p>
        {rows && (
          <dl>
            {rows.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd className="mono">{v}</dd></div>))}
          </dl>
        )}
      </div>
    </li>
  );
}

export function HealthPage() {
  const { t } = useTranslation();
  const health = useStore(() => live.health);
  const sys = useStore(() => live.sysHealth);
  const ws = useStore(() => live.ws);
  const tone = (ok: boolean | undefined): Tone => (ok === undefined ? 'unknown' : ok ? 'ok' : 'bad');
  const word = (ok: boolean | undefined) => (ok === undefined ? '—' : ok ? t('health.up') : t('health.down'));
  const edgeUp = health ? health.edge === 'up' : undefined;
  const clockOk = sys?.edge?.clock_ok;
  const mqtt = sys ? sys.mqtt.connected : health ? health.mqtt === 'up' : undefined;
  const be = (sys?.backend ?? {}) as Record<string, number | undefined>;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{t('health.title')}</h1>
          <p className="lede">{t('health.lede')}</p>
        </div>
      </header>
      <section className="panel">
        <header className="panel-head"><h2>{t('health.path')}</h2></header>
        <ol className="data-path">
          <Hop
            title={t('health.edge')}
            tone={edgeUp === false ? 'warn' : clockOk === false ? 'bad' : tone(edgeUp)}
            status={edgeUp === false ? t('health.stale') : word(edgeUp)}
            rows={[
              [t('health.clock'), clockOk === undefined ? '—' : clockOk ? t('health.clockOk') : t('health.clockBad')],
              [t('health.lastHeartbeat'), fmtClock(sys?.edge?.last_heartbeat_ts)],
            ]}
          />
          <Hop title={t('health.broker')} tone={tone(mqtt)} status={word(mqtt)}
            rows={[[t('health.dropped'), String(be.mqtt_ingest_dropped ?? '—')]]} />
          <Hop title={t('health.backend')} tone={tone(health ? true : undefined)} status={word(health ? true : undefined)}
            rows={[
              [t('health.uptime'), fmtUptime(be.uptime_s)],
              [t('health.wsClients'), String(be.ws_clients ?? '—')],
              [t('health.unknownTags'), String(be.telemetry_unknown_tag ?? '—')],
            ]} />
          <Hop title={t('health.database')} tone={tone(health ? health.db === 'up' : undefined)}
            status={word(health ? health.db === 'up' : undefined)} />
          <Hop title={t('health.browser')} tone={ws === 'open' ? 'ok' : ws === 'reconnecting' || ws === 'connecting' ? 'warn' : 'bad'}
            status={t(ws === 'open' ? 'shell.live' : ws === 'auth_expired' ? 'shell.sessionExpired' : `shell.${ws === 'closed' ? 'offline' : ws}`)}
            rows={[[t('health.dropped'), String(be.ws_msgs_dropped ?? '—')]]} />
        </ol>
      </section>
    </div>
  );
}
