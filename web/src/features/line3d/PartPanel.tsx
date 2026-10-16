// Faceplate for one mapped part: its bound signals (live) plus the commands
// its writable roles allow. Commands go through the normal guarded command
// path (role/edge/clock gate, confirm on stop, lifecycle tracking) — a
// mapping never writes by itself.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { live, STALE_MS } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { formatSignal } from '../../lib/plant';
import { liveName, truthy, type KindSpec, type PlantPart } from '../../lib/plantModel';
import { useControlGate, gateReasonKey } from '../../app/session';
import { useCommand } from '../line/useCommand';
import { LifecyclePill } from '../line/LifecyclePill';
import { QualityMark } from '../../shared/ui/Status';
import { Icon } from '../../shared/ui/Icon';
import { Confirm } from '../../shared/ui/Confirm';

function unitFor(name: string): string | undefined {
  return live.tags.find((t) => t.name === name)?.unit;
}

function Control({ name, role, type, send, busy }: {
  name: string; role: string; type: 'bool' | 'number';
  send: (tag: string, v: number | boolean) => Promise<void>; busy: boolean;
}) {
  const { t } = useTranslation();
  const [confirm, setConfirm] = useState(false);
  const [val, setVal] = useState('');
  if (type === 'bool') {
    const label = role === 'open' || role === 'door' ? ['plant.open', 'plant.close'] : ['control.start', 'control.stop'];
    return (
      <div className="flex gap-2">
        <button className="btn flex-1 justify-center" disabled={busy} onClick={() => void send(name, true)}>
          <Icon name="play" size={14} /> {t(label[0])}
        </button>
        <button className="btn btn-danger flex-1 justify-center" disabled={busy} onClick={() => setConfirm(true)}>
          <Icon name="stop" size={14} /> {t(label[1])}
        </button>
        {confirm && (
          <Confirm
            title={t('plant.confirmOff')}
            body={t('plant.offConsequence')}
            confirm={t(label[1])}
            onYes={() => { setConfirm(false); void send(name, false); }}
            onNo={() => setConfirm(false)}
          />
        )}
      </div>
    );
  }
  return (
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const v = Number(val); if (val !== '' && !Number.isNaN(v)) void send(name, v); }}>
      <input className="input num flex-1" value={val} onChange={(e) => setVal(e.target.value)}
        aria-label={t('control.newValue')} inputMode="decimal" />
      <button className="btn btn-ghost" type="submit" disabled={busy}>{t('control.apply')}</button>
    </form>
  );
}

export function PartPanel({ part, kind }: { part: PlantPart; kind: KindSpec | undefined }) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  useStore(() => live.version);
  const gate = useControlGate();
  const { send, tracked, error, busy } = useCommand();
  const roles = Object.entries(part.bindings);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-ink-46">{kind?.label ?? part.kind}</p>
      {roles.length === 0 && <p className="text-[12px] text-ink-46">{t('plant.noBindings')}</p>}
      <ul className="flex flex-col gap-1.5">
        {roles.map(([role, path]) => {
          const name = liveName(path);
          const tv = live.latest.get(name);
          const stale = !tv || now - Date.parse(tv.ts) > STALE_MS;
          const unit = unitFor(name);
          const isBool = kind?.roles[role]?.type === 'bool';
          return (
            <li key={role} className="flex justify-between gap-2 text-[12px]">
              <span className="text-ink-68">{kind?.roles[role]?.label ?? role}</span>
              <span className="flex items-center gap-1.5 font-mono font-semibold">
                {tv && !stale
                  ? (isBool ? t(truthy(tv.v) ? 'state.on' : 'state.off') : formatSignal(name, tv.v, i18n.language))
                  : '—'}
                {unit && !isBool && <span className="font-sans text-[10px] font-normal text-ink-46">{unit}</span>}
                <QualityMark q={tv?.q} stale={stale} />
              </span>
            </li>
          );
        })}
      </ul>
      {roles.some(([role]) => kind?.roles[role]?.writable) && (
        gate.allowed ? (
          <div className="flex flex-col gap-2 border-t border-line pt-3">
            {roles.filter(([role]) => kind?.roles[role]?.writable).map(([role, path]) => (
              <div key={role} className="flex flex-col gap-1">
                <span className="text-[11px] text-ink-46">{kind?.roles[role]?.label ?? role}</span>
                <Control name={liveName(path)} role={role} type={kind!.roles[role].type} send={send} busy={busy} />
              </div>
            ))}
            {tracked && (
              <p className="flex items-center gap-2 text-[11px] text-ink-46">
                {t('control.sent')} <LifecyclePill status={tracked.status} />
              </p>
            )}
            {error && <p className="notice notice-error" role="alert">{error}</p>}
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded border border-line bg-subtle px-3 py-2 text-[12px] text-ink-68">
            <Icon name="lock" size={14} />
            {t(`control.reason${gate.reason ? gateReasonKey(gate.reason) : 'Role'}`, { defaultValue: t('control.unavailable') })}
          </div>
        )
      )}
    </div>
  );
}
