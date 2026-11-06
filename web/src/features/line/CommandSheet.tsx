// The control sheet: what will happen, the checks, a required reason, a test
// that sends nothing, and the send itself. It is inline (not a modal) so it
// never sits half off-screen on a phone. The server re-runs every gate on send;
// this is the operator's rehearsal, not the guard.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../shared/ui/Icon';
import { ApiError } from '../../lib/api';
import { useCommand, isTerminal, type DryRun } from './useCommand';
import { LifecyclePill } from './LifecyclePill';
import { outcomeOf } from './commandOutcome';
import './i18n';

export interface Pending { tag: string; value: number | boolean; kind: 'start' | 'stop' | 'setpoint' }

const PRESETS = ['reasonPlan', 'reasonAlarm', 'reasonMaint'] as const;
const OTHER = '__other';
const CHECK_IDS = ['reason', 'area', 'writable', 'type', 'range', 'permissive', 'in_flight', 'edge'];

export function CommandSheet({ pending, onClose }: { pending: Pending; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { send, dryRun, tracked, error, busy } = useCommand();
  const [choice, setChoice] = useState('');
  const [other, setOther] = useState('');
  const [dry, setDry] = useState<DryRun | null>(null);
  const [dryError, setDryError] = useState('');
  const [testing, setTesting] = useState(false);
  const [needReason, setNeedReason] = useState(false);
  const head = useRef<HTMLHeadingElement>(null);
  useEffect(() => { head.current?.focus(); }, []);

  const reason = choice === OTHER ? other.trim() : choice ? t(`f05.${choice}`) : '';
  const v = String(pending.value);
  const title = pending.kind === 'start' ? t('f05.titleStart') : pending.kind === 'stop' ? t('f05.titleStop') : t('f05.titleSetpoint', { v });
  const expect = pending.kind === 'start' ? t('f05.expectStart') : pending.kind === 'stop' ? t('f05.expectStop') : t('f05.expectSetpoint', { v });
  const sent = tracked != null;

  const test = async () => {
    setTesting(true); setDryError(''); setNeedReason(false);
    try { setDry(await dryRun(pending.tag, pending.value, reason)); }
    catch (e) { setDry(null); setDryError(e instanceof ApiError ? t('control.authFailed', { status: e.status }) : t('control.failed', { reason: '?' })); }
    finally { setTesting(false); }
  };

  const checkText = (c: DryRun['checks'][number]) => {
    if (c.ok || !c.error) return t(`f05.c_${c.id}`);
    return t(`f05.e_${c.error}`, { min: c.min, max: c.max, tag: c.tag, why: t(`f05.why_${String(c.why)}`, { defaultValue: String(c.why ?? '') }) });
  };

  const out = tracked ? outcomeOf(t, tracked.status, tracked.detail) : null;
  const toneCls = out?.tone === 'ok' ? 'bg-[var(--color-ok-soft)] text-[var(--color-ok)]'
    : out?.tone === 'bad' ? 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]'
    : out?.tone === 'warn' ? 'bg-[var(--color-caution-soft)] text-[var(--color-caution-ink)]' : 'bg-subtle text-ink-68';
  const toneIcon = out?.tone === 'ok' ? 'check' : out?.tone === 'wait' ? 'clock' : 'warn';

  return (
    <section className="min-w-0 rounded border border-line-hard bg-paper" aria-labelledby="f05-title" data-testid="command-sheet">
      <h3 id="f05-title" ref={head} tabIndex={-1} className="border-b border-line px-3 py-2 text-[15px] font-semibold outline-none">{title}</h3>
      <div className="border-b border-line px-3 py-2">
        <h4 className="text-[12px] font-semibold text-ink-68">{t('f05.whatHappens')}</h4>
        <p className="mt-1 text-[13px]" data-testid="expected">{expect}</p>
      </div>

      {!sent && (
        <>
          <div className="flex flex-col gap-2 border-b border-line px-3 py-3">
            <label className="text-[12px] font-semibold text-ink-68" htmlFor="f05-reason">{t('f05.reasonLabel')}</label>
            <select id="f05-reason" className="input min-h-11" value={choice} aria-required="true" aria-invalid={needReason}
              onChange={(e) => { setChoice(e.target.value); setNeedReason(false); setDry(null); }}>
              <option value="">{t('f05.reasonPick')}</option>
              {PRESETS.map((k) => <option key={k} value={k}>{t(`f05.${k}`)}</option>)}
              <option value={OTHER}>{t('f05.reasonOther')}</option>
            </select>
            {choice === OTHER && (
              <>
                <label className="text-[12px] text-ink-68" htmlFor="f05-other">{t('f05.reasonOtherLabel')}</label>
                <input id="f05-other" className="input min-h-11" maxLength={200} value={other}
                  onChange={(e) => { setOther(e.target.value); setNeedReason(false); setDry(null); }} />
              </>
            )}
            {needReason && <p className="text-[12px] text-[var(--color-danger)]" role="alert">{t('f05.reasonRequired')}</p>}
          </div>

          <div className="border-b border-line px-3 py-2">
            <h4 className="text-[12px] font-semibold text-ink-68">{t('f05.checks')}</h4>
            {dry ? (
              <ul className="mt-1 flex flex-col" data-testid="checklist">
                {[...dry.checks].sort((a, b) => CHECK_IDS.indexOf(a.id) - CHECK_IDS.indexOf(b.id)).map((c) => (
                  <li key={c.id} className="flex items-start gap-2 py-1 text-[13px]" data-check={c.id} data-ok={c.ok}>
                    <Icon name={c.ok ? 'check' : 'warn'} size={14} />
                    <span className={c.ok ? '' : 'font-semibold text-[var(--color-danger)]'}>{checkText(c)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-1 text-[13px] text-ink-68" data-testid="checklist-empty">{t('f05.notChecked')}</p>}
            {dry && <p className="mt-1 text-[12px] font-semibold" role="status" data-testid="dry-result">{dry.ok ? t('f05.testOk') : t('f05.testFail')}</p>}
            {dryError && <p className="mt-1 text-[12px] text-[var(--color-danger)]" role="alert">{dryError}</p>}
          </div>

          <div className="flex flex-wrap gap-3 px-3 py-3">
            <button type="button" className="btn btn-ghost min-h-12 flex-1 justify-center" disabled={testing || busy} onClick={() => void test()}>
              <Icon name="check" size={14} /> {testing ? t('f05.testing') : t('f05.test')}
            </button>
            <button type="button" className="btn min-h-12 flex-1 justify-center" disabled={busy}
              onClick={() => { if (!reason) { setNeedReason(true); return; } void send(pending.tag, pending.value, reason); }}>
              <Icon name="play" size={14} /> {busy ? t('f05.sending') : t('f05.send')}
            </button>
            <button type="button" className="btn btn-ghost min-h-12 justify-center" onClick={onClose}>{t('f05.cancel')}</button>
          </div>
          <p className="border-t border-line px-3 py-2 text-[12px] text-ink-68">{t('f05.after')}</p>
          {error && <p className="notice notice-error m-3" role="alert">{error}</p>}
        </>
      )}

      {sent && tracked && out && (
        <div className="flex flex-col gap-3 px-3 py-3" data-testid="outcome" data-tone={out.tone}>
          <p className="flex items-center gap-2 text-[12px] text-ink-46">{t('control.sent')} <LifecyclePill status={tracked.status} /></p>
          <p className={`flex items-start gap-2 rounded px-3 py-2 text-[14px] font-semibold ${toneCls}`} role={isTerminal(tracked.status) ? 'warn' : 'status'}>
            <Icon name={toneIcon} size={16} /> <span>{out.text}</span>
          </p>
          <p className="text-[12px] text-ink-68">{t('f05.reasonLabel')}: {reason}</p>
          {isTerminal(tracked.status) && <button type="button" className="btn min-h-12 justify-center" onClick={onClose}>{i18n.t('common.close', { defaultValue: 'Close' })}</button>}
        </div>
      )}
    </section>
  );
}
