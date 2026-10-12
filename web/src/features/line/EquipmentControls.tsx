// Controls for the drive motor: start/stop + speed setpoint. Shown only when
// the gate allows; otherwise the reason is stated (ADR-14).

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { live } from '../../lib/live';
import { useStore } from '../../lib/hooks';
import { SIGNALS, T, formatSignal } from '../../lib/plant';
import { gateReasonKey, useControlGate } from '../../app/session';
import { Icon } from '../../shared/ui/Icon';
import { Notice } from '../../shared/ui/Feedback';
import { ConfirmCommand, type PendingCommand } from './ConfirmCommand';
import { Lifecycle } from './Lifecycle';
import { useCommand } from './useCommand';

export function MotorControls() {
  const { t, i18n } = useTranslation();
  const gate = useControlGate();
  const running = useStore(() => live.latest.get(T.running));
  const sp = useStore(() => live.latest.get(T.speedSp));
  const { send, tracked, error, busy } = useCommand();
  const [pending, setPending] = useState<(PendingCommand & { value: number | boolean }) | null>(null);
  const [draft, setDraft] = useState('');
  const [min, max] = SIGNALS[T.speedSp].range ?? [0, 60];

  if (!gate.allowed) {
    return (
      <div className="controls">
        <h3>{t('line.controls')}</h3>
        <Notice icon="lock">
          <strong>{t('control.unavailable')}.</strong> {t(gateReasonKey(gate.reason!))}
        </Notice>
      </div>
    );
  }

  const isRunning = running?.v === true;
  const num = Number(draft);
  const draftValid = draft.trim() !== '' && Number.isFinite(num) && num >= min && num <= max;
  const label = (name: string) => t(SIGNALS[name].labelKey);
  const fmt = (name: string, v: number | boolean | undefined) => {
    const s = formatSignal(name, v, i18n.language);
    const unit = SIGNALS[name].unit;
    return typeof v === 'number' && unit ? `${s} ${unit}` : s;
  };

  return (
    <div className="controls">
      <h3>{t('line.controls')}</h3>
      <div className="control-row">
        <button
          className="btn btn-control btn-start" disabled={busy || isRunning}
          onClick={() => setPending({ tag: T.running, label: label(T.running), kind: 'start', value: true,
            from: t('state.stopped'), to: t('state.running') })}
        >
          <Icon name="play" size={18} /> {t('control.start')}
        </button>
        <button
          className="btn btn-control btn-danger" disabled={busy || !isRunning}
          onClick={() => setPending({ tag: T.running, label: label(T.running), kind: 'stop', value: false,
            from: t('state.running'), to: t('state.stopped') })}
        >
          <Icon name="stop" size={18} /> {t('control.stop')}
        </button>
      </div>

      <form
        className="control-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draftValid) return;
          setPending({ tag: T.speedSp, label: label(T.speedSp), kind: 'write', value: num,
            from: fmt(T.speedSp, sp?.v), to: fmt(T.speedSp, num) });
        }}
      >
        <label className="field">
          <span className="field-label">{t('control.newValue')} ({SIGNALS[T.speedSp].unit})</span>
          <input
            className="input num setpoint-input" type="number" inputMode="decimal" step="0.5"
            min={min} max={max} value={draft} placeholder={formatSignal(T.speedSp, sp?.v, i18n.language)}
            onChange={(e) => setDraft(e.target.value)}
            aria-invalid={draft !== '' && !draftValid} aria-describedby="sp-range"
          />
          <span id="sp-range" className="hint">
            {draft !== '' && !draftValid
              ? t('control.outOfRange', { min, max })
              : t('control.range', { min, max, unit: SIGNALS[T.speedSp].unit })}
          </span>
        </label>
        <button type="submit" className="btn btn-control btn-primary" disabled={busy || !draftValid}>
          {t('control.apply')}
        </button>
      </form>

      {error && <Notice tone="error">{error}</Notice>}
      {tracked && <Lifecycle cmd={tracked} />}

      <ConfirmCommand
        pending={pending}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const p = pending;
          setPending(null);
          if (p) { void send(p.tag, p.value); setDraft(''); }
        }}
      />
    </div>
  );
}
