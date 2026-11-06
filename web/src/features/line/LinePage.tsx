// Line view — ISA-101 unit display of sorting line 1: the side-elevation
// schematic (Mimic) on the left, the selected equipment's faceplate on the
// right — its live signals with quality and a short trend, its open alarms,
// and for the drive motor the gated start / stop / speed controls.

import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { live, STALE_MS } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { LINE_EQUIPMENT as EQUIPMENT, SIGNALS, T, formatSignal, unitOf, type LineEquipmentId as EquipmentId } from '../../lib/plant';
import { fmtAge } from '../../lib/format';
import { useControlGate, gateReasonKey } from '../../app/session';
import { useCommand } from './useCommand';
import { LifecyclePill } from './LifecyclePill';
import { QualityMark, SeverityBadge, AlarmStateBadge } from '../../shared/ui/Status';
import { PageBar, Card } from '../../shared/ui/Page';
import { Icon } from '../../shared/ui/Icon';
import { Confirm } from '../../shared/ui/Confirm';
import { ErrorState, PageSkeleton } from '../../shared/ui/Feedback';
import { LineStatusBar } from '../../shared/ui/LineStatusBar';
import { Sparkline } from '../../shared/ui/Sparkline';
import { useAlarms } from '../alarms/alarms';
import { Mimic, ISA_TAG, useLimits } from './Mimic';
import { EquipmentPicker } from '../../shared/ui/EquipmentPicker';

const SP_MIN = 0;
const SP_MAX = 60;

/** Gated write controls (start / stop / speed setpoint). When the role or
 *  link can't operate, the whole card collapses to a reason note. */
function Controls() {
  const { t, i18n } = useTranslation();
  const gate = useControlGate();
  const { send, tracked, error, busy } = useCommand();
  const [sp, setSp] = useState('40');
  const [confirmStop, setConfirmStop] = useState(false);
  const [confirmStart, setConfirmStart] = useState(false);
  const [pendingSp, setPendingSp] = useState<number | null>(null);
  const [spError, setSpError] = useState('');
  useStore(() => live.version);
  const currentSp = live.latest.get(T.speedSp);

  if (!gate.allowed) {
    return (
      <div className="flex items-center gap-2 rounded border border-line bg-subtle px-3 py-2 text-[12px] text-ink-68">
        <Icon name="lock" size={14} />
        {t(gate.reason ? gateReasonKey(gate.reason) : 'control.unavailable')}
      </div>
    );
  }

  return (
    <div className="line-controls flex flex-col gap-3">
      <div className="flex gap-3">
        <button className="btn flex-1 justify-center" disabled={busy} onClick={() => setConfirmStart(true)}>
          <Icon name="play" size={14} /> {t('control.start')}
        </button>
        <button className="btn btn-danger flex-1 justify-center" disabled={busy} onClick={() => setConfirmStop(true)}>
          <Icon name="stop" size={14} /> {t('control.stop')}
        </button>
        {confirmStart && (
          <Confirm
            title={t('control.confirmStartTitle')}
            body={t('control.startConsequence')}
            confirm={t('control.start')}
            danger={false}
            onYes={() => { setConfirmStart(false); void send(T.running, true); }}
            onNo={() => setConfirmStart(false)}
          />
        )}
        {pendingSp !== null && (
          <Confirm
            title={t('control.confirmWriteTitle')}
            body={`${t('control.writeConsequence')} ${t('control.to')}: ${pendingSp} Hz`}
            confirm={t('control.confirm')}
            danger={false}
            onYes={() => { const v = pendingSp; setPendingSp(null); void send(T.speedSp, v); }}
            onNo={() => setPendingSp(null)}
          />
        )}
        {confirmStop && (
          <Confirm
            title={t('control.confirmStopTitle')}
            body={t('control.stopConsequence')}
            confirm={t('control.stop')}
            onYes={() => { setConfirmStop(false); void send(T.running, false); }}
            onNo={() => setConfirmStop(false)}
          />
        )}
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
          setPendingSp(v);
        }}
      >
        <input
          className="input num flex-1" value={sp} onChange={(e) => { setSp(e.target.value); setSpError(''); }}
          aria-invalid={spError !== ''}
          aria-label={t('control.newValue')} inputMode="decimal"
        />
        <button className="btn btn-ghost" type="submit" disabled={busy}>{t('control.apply')}</button>
      </form>
      <p className="text-[10px] text-ink-46">
        {t('control.range', { min: SP_MIN, max: SP_MAX, unit: 'Hz' })}
        {currentSp && ` · ${t('line.nowHz', { v: formatSignal(T.speedSp, currentSp.v, i18n.language) })}`}
      </p>
      {spError && <p className="notice notice-error" role="alert">{spError}</p>}
      {tracked && (
        <p className="flex items-center gap-2 text-[11px] text-ink-46">
          {t('control.sent')} <LifecyclePill status={tracked.status} />
        </p>
      )}
      {error && <p className="notice notice-error" role="alert">{error}</p>}
    </div>
  );
}

/** Faceplate of the selected equipment: signals (value, quality, trend
 *  against the alarm limit), the equipment's open alarms, and — on the drive
 *  motor — the line controls. */
function Faceplate({ id, onSelect }: { id: EquipmentId; onSelect: (id: EquipmentId) => void }) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  useStore(() => live.version);
  const { open } = useAlarms();
  const limits = useLimits();
  const eq = EQUIPMENT.find((e) => e.id === id)!;
  const alarms = open.filter((a) => eq.signals.includes(a.tag));
  return (
    <Card title={`${ISA_TAG[id]} · ${t(eq.labelKey)}`}>
      <dl className="flex flex-col divide-y divide-line">
        {eq.signals.map((tag) => {
          const tv = live.latest.get(tag);
          const stale = !tv || now - Date.parse(tv.ts) > STALE_MS;
          const numeric = tv != null && typeof tv.v === 'number' && tag !== T.speedSp;
          const limit = limits.get(tag)?.[0]?.threshold ?? undefined;
          return (
            <div key={tag} className="py-2 first:pt-0">
              <div className="flex items-baseline justify-between gap-2">
                <dt className="truncate text-[12px] text-ink-68">{SIGNALS[tag] ? t(SIGNALS[tag].labelKey) : tag}</dt>
                <dd className="flex items-center gap-1.5 font-mono text-[18px] font-semibold tabular-nums">
                  {tv && !stale ? formatSignal(tag, tv.v, i18n.language) : '—'}
                  {unitOf(tag) && <span className="font-sans text-[11px] font-normal text-ink-46">{unitOf(tag)}</span>}
                  <QualityMark q={tv?.q} stale={stale} />
                </dd>
              </div>
              {numeric && <div className="mt-1"><Sparkline tag={tag} limit={limit ?? undefined} /></div>}
            </div>
          );
        })}
      </dl>
      <h3 className="mb-1.5 mt-3 text-[12px] font-semibold text-ink-68">{t('line.alarmsHere')}</h3>
      {alarms.length === 0 ? (
        <p className="text-[12px] text-ink-46">{t('line.noAlarmsHere')}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {alarms.map((a) => (
            <li key={a.id}>
              <Link to={`/alarms?alarm=${encodeURIComponent(String(a.id))}`} className="flex flex-wrap items-center gap-2 rounded border border-line px-2 py-1.5 text-[12px] hover:border-line-hard focus-visible:outline-2 focus-visible:outline-blue">
                <SeverityBadge severity={a.severity} />
                <span className="min-w-0 flex-1 truncate font-medium">{a.rule}</span>
                <AlarmStateBadge state={a.state} ackedBy={a.acked_by} />
                <span className="text-ink-46">{fmtAge(a.ts, now)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 border-t border-line pt-3">
        <h3 className="mb-2 text-[12px] font-semibold text-ink-68">{t('line.controls')}</h3>
        {id === 'motor' ? <Controls /> : (
          <button type="button" className="btn btn-ghost" onClick={() => onSelect('motor')}>
            {t('line.controlsOnMotor', { tag: ISA_TAG.motor })}
          </button>
        )}
      </div>
    </Card>
  );
}

export function LinePage() {
  const { t } = useTranslation();
  const now = useNow();
  const [sel, setSel] = useState<EquipmentId>('motor');
  useStore(() => live.version);
  const seeded = useStore(() => live.tagRev);
  const seedError = useStore(() => live.seedRev);

  if (seedError && !live.tagsSeeded) {
    return <><PageBar title={t('line.title')} /><ErrorState onRetry={() => window.location.reload()} /></>;
  }
  if (!live.tagsSeeded && !seeded) {
    return <><PageBar title={t('line.title')} /><PageSkeleton /></>;
  }

  const runTs = live.latest.get(T.running)?.ts;

  return (
    <>
      <PageBar title={t('line.title')} lede={t('line.lede')} actions={<EquipmentPicker />} />
      <div className="flex flex-col gap-3 p-4">
        <LineStatusBar />
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card title={t('line.schematic')} pad={false}
            actions={<span className="text-[11px] text-ink-46">{t('line.selectHint')}{runTs && ` · ${t('state.updated', { age: fmtAge(runTs, now) })}`}</span>}>
            <div className="overflow-x-auto p-2"><Mimic sel={sel} onSelect={setSel} /></div>
            <p className="border-t border-line px-3 py-2 text-[11px] text-ink-46">{t('line.legend')}</p>
          </Card>
          <Faceplate id={sel} onSelect={setSel} />
        </div>
      </div>
    </>
  );
}
