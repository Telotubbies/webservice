// Inspector of the line console (D2): the selected equipment as a dark
// readout with quality and age, the gated controls (the same CommandSheet as
// before), its configured limits, its last command and its open alarms.
// Read-only roles see the reason, never a clickable send.

import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { live } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { LINE_EQUIPMENT as EQUIPMENT, SIGNALS, T, displayNumber, formatSignal, unitOf } from '../../lib/plant';
import { fmtAge, fmtClock } from '../../lib/format';
import { useControlGate, gateReasonKey } from '../../app/session';
import { CommandSheet, type Pending } from './CommandSheet';
import { Readout } from '../../shared/ui/Readout';
import { SectionTag } from '../../shared/ui/ConsoleKit';
import { CommandChip } from '../../shared/ui/ConsoleKit';
import { SeverityBadge, AlarmStateBadge } from '../../shared/ui/Status';
import { DdIcon } from '../../shared/ui/DdIcon';
import { useAlarms } from '../alarms/alarms';
import { useLimits } from './Mimic';
import { QualityState, RunMark } from './LineMarks';
import type { EquipmentRow } from './lineModel';

const SP_MIN = 0;
const SP_MAX = 60;

/** Gated write controls (start / stop / speed setpoint). Each action opens the
 *  control sheet (expected result, checks, reason, test, send). When the role
 *  or link can't operate, the whole block collapses to a reason note. */
function Controls() {
  const { t, i18n } = useTranslation();
  const gate = useControlGate();
  const [sp, setSp] = useState('40');
  const [pending, setPending] = useState<Pending | null>(null);
  const [spError, setSpError] = useState('');
  useStore(() => live.version);
  const currentSp = live.latest.get(T.speedSp);

  if (!gate.allowed) {
    return (
      <div className="flex items-center gap-2 rounded border border-line bg-subtle px-3 py-2 text-[14px] text-ink-68">
        <DdIcon name="lock" size={14} />
        {t(gate.reason ? gateReasonKey(gate.reason) : 'control.unavailable')}
      </div>
    );
  }

  if (pending) {
    return <CommandSheet key={`${pending.tag}-${String(pending.value)}`} pending={pending} onClose={() => setPending(null)} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3">
        <button className="btn min-h-12 flex-1 justify-center" onClick={() => setPending({ tag: T.running, value: true, kind: 'start' })}>
          <DdIcon name="play" size={14} /> {t('control.start')}
        </button>
        <button className="btn btn-danger min-h-12 flex-1 justify-center" onClick={() => setPending({ tag: T.running, value: false, kind: 'stop' })}>
          <DdIcon name="stop" size={14} /> {t('control.stop')}
        </button>
      </div>
      <form
        className="flex gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          // Number('') === 0, so blank input must be rejected explicitly.
          const v = sp.trim() === '' ? NaN : Number(sp);
          if (!Number.isFinite(v) || v < SP_MIN || v > SP_MAX) {
            setSpError(t('control.outOfRange', { min: SP_MIN, max: SP_MAX }));
            return;
          }
          setSpError('');
          setPending({ tag: T.speedSp, value: v, kind: 'setpoint' });
        }}
      >
        <input
          id="line-setpoint"
          className="input num min-h-12 min-w-0 flex-1" value={sp} onChange={(e) => { setSp(e.target.value); setSpError(''); }}
          aria-invalid={spError !== ''}
          aria-label={t('control.newValue')} inputMode="decimal"
        />
        <button className="btn btn-ghost min-h-12" type="submit">{t('control.apply')}</button>
      </form>
      <p className="text-[13px] text-ink-46">
        {t('control.range', { min: SP_MIN, max: SP_MAX, unit: 'Hz' })}
        {currentSp && ` · ${t('line.nowHz', { v: formatSignal(T.speedSp, currentSp.v, i18n.language) })}`}
      </p>
      {spError && <p className="notice notice-error" role="alert">{spError}</p>}
    </div>
  );
}

export function Inspector({ id, row, onSelect }: { id: string; row: EquipmentRow; onSelect: (id: string) => void }) {
  const { t } = useTranslation();
  const now = useNow();
  useStore(() => live.version);
  const gate = useControlGate();
  const { open } = useAlarms();
  const limits = useLimits();
  const eq = EQUIPMENT.find((e) => e.id === id) ?? EQUIPMENT[0];
  const alarms = open.filter((a) => eq.signals.includes(a.tag));
  const meta = SIGNALS[row.tag];
  const [min, max] = meta?.range ?? [0, 100];
  const value = row.reading == null ? 0 : displayNumber(row.tag, row.reading);
  const rules = eq.signals.flatMap((tag) => (limits.get(tag) ?? []).map((r) => ({ tag, rule: r })));

  // Three short fields: the reference's readout is the same height on a
  // 300 px panel and a 390 px screen, so no field may need clipping.
  const dims = [
    { label: t('d2.dimState'), value: row.hasRunSignal ? t(`state.${row.state}`) : '—' },
    { label: t('d2.range'), value: `${min}–${max}${unitOf(row.tag) ? ` ${unitOf(row.tag)}` : ''}` },
    { label: t('d2.dimTime'), value: fmtClock(row.ts) },
  ];

  return (
    <section
      id="line-inspector"
      tabIndex={-1}
      aria-label={t('d2.selected')}
      className="flex min-w-0 flex-col gap-3 rounded-[5px] border border-line bg-paper p-3 focus-visible:outline-2 focus-visible:outline-blue"
    >
      <div>
        <SectionTag>{t('d2.selected')}</SectionTag>
        <h2 className="mt-1.5 text-[18px] font-semibold leading-tight">{t(eq.labelKey)}</h2>
        <p className="truncate font-mono text-[11px] text-ink-46" title={row.tag}>{row.tag}</p>
      </div>

      <Readout
        label={meta ? t(meta.labelKey) : row.tag}
        value={value}
        valueText={row.reading == null ? '—' : undefined}
        unit={unitOf(row.tag)}
        decimals={meta?.decimals ?? 1}
        dims={dims}
        min={min}
        max={max}
        limits={row.limits}
        loText={row.limits.lo != null ? `LO ${row.limits.lo}` : undefined}
        hiText={row.limits.hi != null ? `HI ${row.limits.hi}` : undefined}
        state={row.reading == null ? 'error' : row.stale ? 'stale' : 'live'}
        stateLabel={row.reading == null
          ? t('d2.noReading')
          : row.stale
            ? `${t('d2.notCurrent')} · ${fmtAge(row.ts, now)}`
            : `${t('state.good')} · ${fmtAge(row.ts, now)}`}
      />

      <div className="flex flex-col gap-2 border-t border-line pt-3">
        <h3 className="text-[13px] font-semibold text-ink-68">{t('line.controls')}</h3>
        {id === 'motor' ? <Controls /> : (
          <button type="button" className="btn btn-ghost min-h-11 justify-center" onClick={() => onSelect('motor')}>
            {t('line.controlsOnMotor', { tag: 'M-101' })}
          </button>
        )}
        {!gate.allowed && (
          <p className="flex items-start gap-1.5 text-[13px] text-ink-46">
            <DdIcon name="shield" size={13} className="mt-0.5 shrink-0" />{t('d2.viewerNote')}
          </p>
        )}
      </div>

      <div className="border-t border-line pt-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-ink-68">{t('d2.limits')}</h3>
          <span className="text-[12px] text-ink-46">{t('d2.limitsFrom')}</span>
        </div>
        {rules.length === 0 ? (
          <p className="mt-1 text-[13px] text-ink-46">{t('d2.noLimits')}</p>
        ) : (
          <dl className="mt-1 flex flex-col divide-y divide-line">
            {rules.map(({ tag, rule }) => (
              <div key={`${tag}-${rule.kind}-${rule.threshold}`} className="flex items-baseline justify-between gap-2 py-1">
                <dt className="min-w-0 break-words text-[13px] text-ink-68">{t(`alx.ruleKind.${rule.kind}`)}{tag !== row.tag && <span className="ml-1 font-mono text-[11px] text-ink-46">{tag.split('.').slice(-2).join('.')}</span>}</dt>
                <dd className="shrink-0 font-mono text-[13px] tabular-nums">{rule.threshold} <span className="text-[11px] text-ink-46">{unitOf(tag)}</span></dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <div className="border-t border-line pt-2">
        <h3 className="text-[13px] font-semibold text-ink-68">{t('d2.lastCommand')}</h3>
        {row.command ? (
          <p className="mt-1 flex items-center gap-2 text-[13px]">
            <CommandChip code={row.command.code} label={row.command.code} />
            <span className="text-ink-46">{fmtAge(row.command.at, now)}</span>
          </p>
        ) : <p className="mt-1 text-[13px] text-ink-46">{t('d2.neverCommanded')}</p>}
      </div>

      <div className="border-t border-line pt-2">
        <h3 className="mb-1 text-[13px] font-semibold text-ink-68">{t('line.alarmsHere')}</h3>
        {alarms.length === 0 ? (
          <p className="text-[13px] text-ink-46">{t('line.noAlarmsHere')}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {alarms.map((a) => (
              <li key={a.id}>
                <Link to={`/alarms?alarm=${encodeURIComponent(String(a.id))}`} className="flex flex-wrap items-center gap-2 rounded border border-line px-2 py-1.5 text-[13px] hover:border-line-hard focus-visible:outline-2 focus-visible:outline-blue">
                  <SeverityBadge severity={a.severity} />
                  <span className="min-w-0 flex-1 truncate font-medium">{a.rule}</span>
                  <AlarmStateBadge state={a.state} ackedBy={a.acked_by} />
                  <span className="text-ink-46">{fmtAge(a.ts, now)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-line pt-2 text-[13px] text-ink-68">
        {row.hasRunSignal ? <RunMark state={row.state} /> : <span>{t('side.none')}</span>}
        {(row.stale || (row.quality && row.quality !== 'good')) && <QualityState q={row.quality} stale={row.stale} />}
      </div>
    </section>
  );
}
