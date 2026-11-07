// Line view — ISA-101 unit display of sorting line 1: the side-elevation
// schematic (Mimic) on the left, the selected equipment's faceplate on the
// right — its live signals with quality and a short trend, its open alarms,
// and for the drive motor the gated start / stop / speed controls.

import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { live, STALE_MS } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { LINE_EQUIPMENT as EQUIPMENT, SIGNALS, T, formatSignal, unitOf, type LineEquipmentId as EquipmentId } from '../../lib/plant';
import { fmtAge } from '../../lib/format';
import { useControlGate, gateReasonKey } from '../../app/session';
import { CommandSheet, type Pending } from './CommandSheet';
import { QualityMark, SeverityBadge, AlarmStateBadge } from '../../shared/ui/Status';
import { PageBar, Card } from '../../shared/ui/Page';
import { Icon } from '../../shared/ui/Icon';
import { ErrorState, PageSkeleton } from '../../shared/ui/Feedback';
import { LineStatusBar } from '../../shared/ui/LineStatusBar';
import { Sparkline } from '../../shared/ui/Sparkline';
import { useAlarms } from '../alarms/alarms';
import { Mimic, ISA_TAG, useLimits } from './Mimic';
import { EquipmentPicker } from '../../shared/ui/EquipmentPicker';
import { useSceneSource } from '../line3d/useSceneSource';
import { PartPanel } from '../line3d/PartPanel';
import { SideView, SideList, SideLegend } from './SideView';

const SP_MIN = 0;
const SP_MAX = 60;

/** Gated write controls (start / stop / speed setpoint). Each action opens the
 *  control sheet (expected result, checks, reason, test, send). When the role
 *  or link can't operate, the whole card collapses to a reason note. */
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
      <div className="flex items-center gap-2 rounded border border-line bg-subtle px-3 py-2 text-[12px] text-ink-68">
        <Icon name="lock" size={14} />
        {t(gate.reason ? gateReasonKey(gate.reason) : 'control.unavailable')}
      </div>
    );
  }

  if (pending) {
    return <CommandSheet key={`${pending.tag}-${String(pending.value)}`} pending={pending} onClose={() => setPending(null)} />;
  }

  return (
    <div className="line-controls flex flex-col gap-4">
      <div className="flex gap-4">
        <button className="btn min-h-12 flex-1 justify-center" onClick={() => setPending({ tag: T.running, value: true, kind: 'start' })}>
          <Icon name="play" size={14} /> {t('control.start')}
        </button>
        <button className="btn btn-danger min-h-12 flex-1 justify-center" onClick={() => setPending({ tag: T.running, value: false, kind: 'stop' })}>
          <Icon name="stop" size={14} /> {t('control.stop')}
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
          className="input num min-h-12 min-w-0 flex-1" value={sp} onChange={(e) => { setSp(e.target.value); setSpError(''); }}
          aria-invalid={spError !== ''}
          aria-label={t('control.newValue')} inputMode="decimal"
        />
        <button className="btn btn-ghost min-h-12" type="submit">{t('control.apply')}</button>
      </form>
      <p className="text-[12px] text-ink-46">
        {t('control.range', { min: SP_MIN, max: SP_MAX, unit: 'Hz' })}
        {currentSp && ` · ${t('line.nowHz', { v: formatSignal(T.speedSp, currentSp.v, i18n.language) })}`}
      </p>
      {spError && <p className="notice notice-error" role="alert">{spError}</p>}
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

/** Side view: the plant's parts as a process-flow elevation, with the same
 *  part panel as the Plant twin underneath. */
function SideViewCard() {
  const { t } = useTranslation();
  const src = useSceneSource();
  const [sel, setSel] = useState<string | null>(null);
  const part = sel !== null ? src.parts[Number(sel)] : undefined;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-3 min-[1700px]:grid-cols-[minmax(0,1fr)_340px]">
      <Card title={t('side.title')} pad={false} actions={<SideLegend />}>
        {src.status !== 'ready' ? (
          <p className="p-4 text-[12px] text-ink-46" role="status">{t('side.loading')}</p>
        ) : (
          <>
            <div className="relative">
              <SideView parts={src.parts} sel={sel} onSelect={setSel} />
              <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-paper to-transparent md:hidden" />
            </div>
            <p className="px-3 pb-1 pt-2 text-[11px] text-ink-46 md:hidden">{t('side.scroll')}</p>
            <p className="border-t border-line px-3 py-2 text-[11px] text-ink-46">{t('side.hint')}</p>
            <div className="border-t border-line p-3 md:hidden"><SideList parts={src.parts} sel={sel} onSelect={setSel} /></div>
          </>
        )}
      </Card>
      <Card title={part ? part.label : t('faceplate.title')}>
        {part ? <PartPanel part={part} kind={src.kinds[part.kind]} /> : <p className="text-[12px] text-ink-46">{t('side.empty')}</p>}
      </Card>
    </div>
  );
}

export function LinePage() {
  const { t } = useTranslation();
  const now = useNow();
  const [sel, setSel] = useState<EquipmentId>('motor');
  const [params, setParams] = useSearchParams();
  const side = params.get('view') === 'side';
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
        <div className="flex overflow-hidden self-start rounded border border-line" role="group" aria-label={t('side.view')}>
          {[false, true].map((v) => (
            <button key={String(v)} type="button" aria-pressed={side === v}
              onClick={() => setParams(v ? { view: 'side' } : {}, { replace: true })}
              className={`h-8 px-3 text-[12px] font-semibold ${side === v ? 'bg-info-soft text-blue' : 'text-ink-68 hover:bg-subtle'}`}>
              {v ? t('side.tab') : t('side.schematic')}
            </button>
          ))}
        </div>
        {side ? <SideViewCard /> : (
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card title={t('line.schematic')} pad={false}
            actions={<span className="text-[11px] text-ink-46">{t('line.selectHint')}{runTs && ` · ${t('state.updated', { age: fmtAge(runTs, now) })}`}</span>}>
            <div className="relative">
              <div className="overflow-x-auto p-2" tabIndex={0} role="region" aria-label={t('line.schematic')}><Mimic sel={sel} onSelect={setSel} /></div>
              <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-paper to-transparent md:hidden" />
            </div>
            <p className="px-3 pb-1 text-[11px] text-ink-46 md:hidden">{t('line.scrollHint')}</p>
            <p className="border-t border-line px-3 py-2 text-[11px] text-ink-46">{t('line.legend')}</p>
          </Card>
          <Faceplate id={sel} onSelect={setSel} />
        </div>
        )}
      </div>
    </>
  );
}
