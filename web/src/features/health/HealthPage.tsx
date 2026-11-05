// System health — service cards from live.health + live.sysHealth
// (MQTT, edge gateway, DB, backend uptime). Operator-only detail per T8.

import { useTranslation } from 'react-i18next';
import { live } from '../../lib/live';
import { api } from '../../lib/api';
import { useNow, useStore } from '../../lib/hooks';
import { fmtUptime, fmtAge } from '../../lib/format';
import { canOperate, useRole } from '../../app/session';
import { PageBar, Card } from '../../shared/ui/Page';
import { ErrorState } from '../../shared/ui/Feedback';
import { DdIcon } from '../../shared/ui/DdIcon';
import { EdgeFleetTable } from './EdgeFleetTable';

/** One hop of the data path. Up is the normal state, so it stays neutral;
 *  only a down hop takes colour (▲, red). `up` undefined is "not reported" —
 *  shown as an open ring, never guessed. */
function PathStep({ name, up, detail, last }: { name: string; up?: boolean; detail: string; last?: boolean }) {
  const { t } = useTranslation();
  const down = up === false;
  return (
    <li className="relative flex min-w-0 flex-1 items-start gap-2.5 px-4 py-3">
      <span aria-hidden className={`mt-0.5 w-3 shrink-0 text-center text-[11px] ${down ? 'text-[var(--color-danger-bright)]' : up ? 'text-ink' : 'text-ink-46'}`}>
        {down ? '▲' : up ? '●' : '◌'}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold">{name}</span>
        <span className={`block text-[12px] ${down ? 'font-semibold text-[var(--color-danger)]' : 'text-ink-68'}`}>
          {up === undefined ? t('health.na') : up ? t('health.up') : t('health.down')}
          {detail && detail !== '—' ? <span className="text-ink-46"> · {detail}</span> : null}
        </span>
      </span>
      {/* connector to the next hop — dashed where this hop is down, so the break reads in place */}
      {!last && (
        <span aria-hidden className={`absolute -right-2 top-1/2 z-[1] hidden h-4 w-4 -translate-y-1/2 place-items-center rounded-full border bg-paper text-[10px] md:grid ${down ? 'border-[var(--color-danger-bright)] text-[var(--color-danger-bright)]' : 'border-line text-ink-46'}`}>
          <DdIcon name="caret-right" size={9} />
        </span>
      )}
    </li>
  );
}

const WS_KEY: Record<string, string> = {
  open: 'shell.live', connecting: 'shell.connecting', reconnecting: 'shell.reconnecting',
  closed: 'shell.offline', auth_expired: 'shell.sessionExpired',
  resyncing: 'shell.reconnecting', forbidden: 'shell.offline',
};

export function HealthPage() {
  const { t } = useTranslation();
  const now = useNow();
  useStore(() => live.healthRev);
  useStore(() => live.seedRev);
  useStore(() => live.wsRev);
  const role = useRole();
  const h = live.health;
  const sys = live.sysHealth;

  const status = (v: string) => t(`health.${v}`, { defaultValue: v });
  const retry = () => {
    void api.health().then((x) => live.setHealth(x)).catch(() => live.setHealth(null));
    if (canOperate(role)) {
      void api.systemHealth().then((x) => live.setSysHealth(x)).catch(() => live.setSysHealth(null));
    }
  };

  return (
    <>
      <PageBar title={t('nav.health')} lede={t('health.lede')} />
      {live.seedError && h === null ? (
        <div className="p-4"><ErrorState onRetry={retry} /></div>
      ) : (
        <div className="p-4">
          {/* the hops in data order: gateway → broker → database → this screen */}
          <ol className="flex flex-col divide-y divide-line rounded-[5px] border border-line bg-paper shadow-card md:flex-row md:divide-x md:divide-y-0" aria-label={t('health.lede')}>
            <PathStep name={t('health.edge')} up={h ? h.edge === 'up' : undefined} detail={h ? status(h.edge) : '—'} />
            <PathStep name={t('health.broker')} up={h ? h.mqtt === 'up' : undefined} detail={h ? status(h.mqtt) : '—'} />
            <PathStep name={t('health.database')} up={h ? h.db === 'up' : undefined} detail={h ? status(h.db) : '—'} />
            <PathStep name={t('health.websocket')} up={live.ws === 'open'} detail={t(WS_KEY[live.ws] ?? 'shell.offline')} last />
          </ol>
        </div>
      )}

      {canOperate(role) && !sys && live.seedError && (
        <div className="px-4 pb-4"><ErrorState onRetry={retry} /></div>
      )}
      {canOperate(role) && sys && (
        <div className="grid gap-3 px-4 pb-4 md:grid-cols-2">
          <Card title={t('health.edgeDetail')}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
              <dt className="text-ink-46">{t('health.lastHeartbeat')}</dt>
              <dd>{sys.edge.last_heartbeat_ts ? fmtAge(sys.edge.last_heartbeat_ts, now) : '—'}</dd>
              <dt className="text-ink-46">{t('health.clock')}</dt>
              <dd className={sys.edge.clock_ok === false ? 'font-semibold text-[var(--color-danger)]' : ''}>{sys.edge.clock_ok == null ? '—' : sys.edge.clock_ok ? t('health.yes') : <><span aria-hidden>▲ </span>{t('health.no')}</>}</dd>
            </dl>
          </Card>
          <Card title={t('health.backend')}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
              <dt className="text-ink-46">{t('health.uptime')}</dt>
              <dd>{fmtUptime(sys.backend.uptime_s)}</dd>
              <dt className="text-ink-46">{t('health.mqttConnected')}</dt>
              <dd>{sys.mqtt.connected ? t('health.yes') : t('health.no')}</dd>
            </dl>
          </Card>
        </div>
      )}

      {/* F22 — edge fleet inventory (member-read v2, safe for every role) */}
      <div className="px-4 pb-4"><EdgeFleetTable /></div>
    </>
  );
}
