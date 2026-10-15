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
import { Icon } from '../../shared/ui/Icon';

function tone(up: boolean | undefined) {
  return up === undefined ? 'text-ink-35' : up ? 'text-[var(--color-ok)]' : 'text-[var(--color-danger-bright)]';
}

function ServiceCard({ name, up, detail }: { name: string; up?: boolean; detail: string }) {
  const { t } = useTranslation();
  return (
    <Card>
      <div className="flex items-center gap-3">
        <span className={`grid h-9 w-9 place-items-center rounded-md bg-subtle ${tone(up)}`}>
          <Icon name={up === false ? 'warn' : 'check-circle'} size={18} />
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold">{name}</div>
          <div className="truncate font-mono text-[11px] text-ink-46">{detail}</div>
        </div>
        <span className={`ml-auto text-[11px] font-bold uppercase ${tone(up)}`}>
          {up === undefined ? t('health.na') : up ? t('health.up') : t('health.down')}
        </span>
      </div>
    </Card>
  );
}

const WS_KEY: Record<string, string> = {
  open: 'shell.live', connecting: 'shell.connecting', reconnecting: 'shell.reconnecting',
  closed: 'shell.offline', auth_expired: 'shell.sessionExpired',
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
        <div className="grid gap-3 p-4 md:grid-cols-2">
          <ServiceCard name={t('health.broker')} up={h ? h.mqtt === 'up' : undefined} detail={h ? status(h.mqtt) : '—'} />
          <ServiceCard name={t('health.edge')} up={h ? h.edge === 'up' : undefined} detail={h ? status(h.edge) : '—'} />
          <ServiceCard name={t('health.database')} up={h ? h.db === 'up' : undefined} detail={h ? status(h.db) : '—'} />
          <ServiceCard name={t('health.websocket')} up={live.ws === 'open'} detail={t(WS_KEY[live.ws] ?? 'shell.offline')} />
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
              <dd className="font-mono">{sys.edge.last_heartbeat_ts ? fmtAge(sys.edge.last_heartbeat_ts, now) : '—'}</dd>
              <dt className="text-ink-46">{t('health.clock')}</dt>
              <dd className={sys.edge.clock_ok ? 'text-[var(--color-ok)]' : 'text-[var(--color-danger-bright)]'}>{sys.edge.clock_ok == null ? '—' : sys.edge.clock_ok ? t('health.yes') : t('health.no')}</dd>
            </dl>
          </Card>
          <Card title={t('health.backend')}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
              <dt className="text-ink-46">{t('health.uptime')}</dt>
              <dd className="font-mono">{fmtUptime(sys.backend.uptime_s)}</dd>
              <dt className="text-ink-46">{t('health.mqttConnected')}</dt>
              <dd>{sys.mqtt.connected ? t('health.yes') : t('health.no')}</dd>
            </dl>
          </Card>
        </div>
      )}
    </>
  );
}
