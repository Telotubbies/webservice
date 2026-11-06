// Faceplate for one mapped part: its bound signals (live) plus the commands
// its writable roles allow. Commands go through the normal guarded command
// path: every action opens F05's control sheet (expected result, checks, a
// required reason, dry run) — a mapping never writes by itself.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { live, STALE_MS } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { formatSignal } from '../../lib/plant';
import { liveName, truthy, type KindSpec, type PlantPart } from '../../lib/plantModel';
import { useControlGate, gateReasonKey } from '../../app/session';
import { CommandSheet, type Pending } from '../line/CommandSheet';
import { QualityMark } from '../../shared/ui/Status';
import { Icon } from '../../shared/ui/Icon';

function unitFor(name: string): string | undefined {
  return live.tags.find((t) => t.name === name)?.unit;
}

// One writable role's control: bool roles get start/stop (open/close for
// doors) with a confirm on the destructive half; number roles get a
// value box + apply.
function Control({ name, role, type, ask }: {
  name: string; role: string; type: 'bool' | 'number';
  ask: (p: Pending) => void;
}) {
  const { t } = useTranslation();
  const [val, setVal] = useState('');
  if (type === 'bool') {
    const label = role === 'open' || role === 'door' ? ['plant.open', 'plant.close'] : ['control.start', 'control.stop'];
    return (
      <div className="flex gap-2">
        <button className="btn flex-1 justify-center" onClick={() => ask({ tag: name, value: true, kind: 'start' })}>
          <Icon name="play" size={14} /> {t(label[0])}
        </button>
        <button className="btn btn-danger flex-1 justify-center" onClick={() => ask({ tag: name, value: false, kind: 'stop' })}>
          <Icon name="stop" size={14} /> {t(label[1])}
        </button>
      </div>
    );
  }
  return (
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const v = Number(val); if (val !== '' && !Number.isNaN(v)) ask({ tag: name, value: v, kind: 'setpoint' }); }}>
      <input className="input num flex-1" value={val} onChange={(e) => setVal(e.target.value)}
        aria-label={t('control.newValue')} inputMode="decimal" />
      <button className="btn btn-ghost" type="submit">{t('control.apply')}</button>
    </form>
  );
}

export function PartPanel({ part, kind }: { part: PlantPart; kind: KindSpec | undefined }) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  useStore(() => live.version);
  const gate = useControlGate();
  const [pending, setPending] = useState<Pending | null>(null);
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
        gate.allowed && pending ? (
          <CommandSheet key={`${pending.tag}-${String(pending.value)}`} pending={pending} onClose={() => setPending(null)} />
        ) : gate.allowed ? (
          <div className="flex flex-col gap-2 border-t border-line pt-3">
            {roles.filter(([role]) => kind?.roles[role]?.writable).map(([role, path]) => (
              <div key={role} className="flex flex-col gap-1">
                <span className="text-[11px] text-ink-46">{kind?.roles[role]?.label ?? role}</span>
                <Control name={liveName(path)} role={role} type={kind!.roles[role].type} ask={setPending} />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded border border-line bg-subtle px-3 py-2 text-[12px] text-ink-68">
            <Icon name="lock" size={14} />
            {t(gate.reason ? gateReasonKey(gate.reason) : 'control.unavailable')}
          </div>
        )
      )}
    </div>
  );
}
