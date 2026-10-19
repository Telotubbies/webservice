// Line view — equipment cards (motor/conveyor/camera/bin) with live signals
// + gated controls. The 2D SVG mimic from v4 is intentionally deferred —
// cards carry the same state contract until the new mimic lands.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { live, STALE_MS } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { EQUIPMENT, SIGNALS, T, formatSignal, unitOf, type EquipmentId } from '../../lib/plant';
import { fmtAge } from '../../lib/format';
import { useControlGate, gateReasonKey } from '../../app/session';
import { useCommand } from './useCommand';
import { LifecyclePill } from './LifecyclePill';
import { QualityMark } from '../../shared/ui/Status';
import { PageBar, Card } from '../../shared/ui/Page';
import { Icon } from '../../shared/ui/Icon';
import { Confirm } from '../../shared/ui/Confirm';
import { ErrorState, PageSkeleton } from '../../shared/ui/Feedback';
import { Mimic } from './Mimic';
import { PlanView, usePlantPlan } from '../line3d/PlantPlan';
import { PartPanel } from '../line3d/PartPanel';
import { useSceneSource } from '../line3d/useSceneSource';
import { EquipmentPicker } from '../../shared/ui/EquipmentPicker';

function EquipmentCard({ id, selected, onSelect }: { id: EquipmentId; selected: boolean; onSelect: () => void }) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  useStore(() => live.version);
  const eq = EQUIPMENT.find((e) => e.id === id)!;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      className={`cursor-pointer rounded-[5px] border bg-white p-3 text-left shadow-card transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue ${
        selected ? 'border-blue ring-1 ring-blue/30' : 'border-line hover:border-line-hard'
      }`}
    >
      <div className="flex items-center gap-2">
        <Icon name={id === 'motor' ? 'gauge' : id === 'conveyor' ? 'line' : id === 'camera' ? 'eye' : 'layers'} size={16} className="text-ink-46" />
        <span className="text-[13px] font-semibold">{t(eq.labelKey)}</span>
        {selected && <span className="ml-auto rounded bg-[#e8f1fb] px-1.5 py-0.5 text-[10px] font-bold uppercase text-blue">{t('line.selected')}</span>}
      </div>
      <dl className="mt-2 flex flex-col gap-1">
        {eq.signals.map((tag) => {
          const tv = live.latest.get(tag);
          const stale = !tv || now - Date.parse(tv.ts) > STALE_MS;
          const meta = SIGNALS[tag];
          return (
            <div key={tag} className="flex items-baseline justify-between gap-2">
              <dt className="truncate text-[11px] text-ink-46">{meta ? t(meta.labelKey) : tag}</dt>
              <dd className="flex items-center gap-1.5 font-mono text-[13px] font-semibold">
                {tv && !stale ? formatSignal(tag, tv.v, i18n.language) : '—'}
                {unitOf(tag) && <span className="font-sans text-[10px] font-normal text-ink-46">{unitOf(tag)}</span>}
                <QualityMark q={tv?.q} stale={stale} />
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

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
        {t(`control.reason${gate.reason ? gateReasonKey(gate.reason) : 'Role'}`, { defaultValue: t('control.unavailable') })}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
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
        className="flex gap-2"
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

/** The plant's 2D plan, derived from the uploaded model, with live hotspots
 *  and the same gated faceplate as the 3D twin. */
function PlantSchematic() {
  const { t } = useTranslation();
  const src = useSceneSource();
  const { img, view, failed } = usePlantPlan(src, 'top');
  const [sel, setSel] = useState<string | null>(null);
  const part = sel !== null ? src.parts[Number(sel)] : undefined;
  if (failed) return <Mimic sel={null} onSelect={() => undefined} />;
  if (!img) return <div className="p-6 text-[12px] text-ink-46" role="status">{t('line3d.loading')}</div>;
  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="relative h-[460px] min-w-0">
        <PlanView kind="top" img={img} view={view} parts={src.parts} sel={sel} onSelect={setSel} />
      </div>
      <div className="border-t border-line p-3 lg:border-l lg:border-t-0">
        {part
          ? <><p className="mb-2 text-[13px] font-semibold">{part.label}</p><PartPanel part={part} kind={src.kinds[part.kind]} /></>
          : <p className="text-[12px] text-ink-46">{t('line.selectHint')}</p>}
      </div>
    </div>
  );
}

export function LinePage() {
  const { t } = useTranslation();
  const now = useNow();
  const [sel, setSel] = useState<EquipmentId | null>('conveyor');
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
      <div className="p-4">
        <p className="mb-3 text-[12px] text-ink-46">
          {t('line.selectHint')}
          {runTs && ` · ${t('state.updated', { age: fmtAge(runTs, now) })}`}
        </p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {EQUIPMENT.map((e) => (
            <EquipmentCard key={e.id} id={e.id} selected={sel === e.id} onSelect={() => setSel(e.id)} />
          ))}
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <Card title={t('line.controls')}><Controls /></Card>
        </div>
        <div className="mt-3">
          <Card title={t('line.schematic')} pad={false}>
            <PlantSchematic />
          </Card>
        </div>
      </div>
    </>
  );
}
