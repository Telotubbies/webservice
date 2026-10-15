// Device detail side panel (Infrastructure → row → details). Deep-linked as
// /infrastructure?device=<id> so the wizard, alarms and health can pivot here.
// Answers the technician's three questions in order: is it OK? what do I
// check? what can I do? — state + plain-language meaning, a checklist when
// it is not reporting, then the (admin-only) key actions.

import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { KeyRound, Power, Server, X } from 'lucide-react';
import type { Device } from '../../lib/api';
import { fmtAge } from '../../lib/format';
import { CopyButton } from './SecretReveal';
import { Troubleshoot } from './Troubleshoot';
import { CAUTION_TEXT_CLASS, isAbnormal, STATE_STYLE, type DeviceState } from './devices';

export type DeviceRow = Device & { state: DeviceState; adapterKey: string };

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function StatePill({ state }: { state: DeviceState }) {
  const { t } = useTranslation();
  return (
    <span className={`inline-flex h-5 items-center gap-1 whitespace-nowrap rounded px-1.5 text-[11px] font-semibold ${STATE_STYLE[state].pill}`} data-state={state}>
      <span aria-hidden className="text-[9px] leading-none">{STATE_STYLE[state].glyph}</span>{t(`dev.state.${state}`)}
    </span>
  );
}

export function DeviceDetail({ d, now, admin, siteName, buffer, busy, onClose, onRotate, onDisable }: {
  d: DeviceRow; now: number; admin: boolean; siteName?: string; buffer?: number; busy?: boolean;
  onClose: () => void; onRotate: () => void; onDisable: () => void;
}) {
  const { t, i18n } = useTranslation();
  const boxRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  // focus in, Esc out, Tab trapped, focus restored — but never steal Esc from
  // a Confirm dialog stacked on top (it owns the first Esc).
  useEffect(() => {
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[role="alertdialog"]')) return;
      if (e.key === 'Escape') { e.preventDefault(); onCloseRef.current(); return; }
      if (e.key !== 'Tab' || !boxRef.current) return;
      const items = Array.from(boxRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute('disabled'));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const a = document.activeElement;
      if (e.shiftKey ? a === first || !boxRef.current.contains(a) : a === last || !boxRef.current.contains(a)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); prev?.focus(); };
  }, []);

  const abnormal = isAbnormal(d.state);
  const hbAbs = d.last_hb_at ? new Date(d.last_hb_at).toLocaleString(i18n.language, { hour12: false }) : '';

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-ink/30" onClick={onClose}>
      <div ref={boxRef} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-[460px] flex-col bg-white shadow-flyout" data-device={d.id}>
        <header className="flex items-start gap-2 border-b border-line px-4 py-3">
          <Server size={18} className="mt-0.5 shrink-0 text-ink-46" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="break-words text-[15px] font-semibold">{d.name}</h2>
            <div className="mt-1"><StatePill state={d.state} /></div>
          </div>
          <button ref={closeRef} type="button" className="grid h-8 w-8 shrink-0 place-items-center rounded hover:bg-subtle" aria-label={t('common.close')} title={t('common.close')} onClick={onClose}>
            <X size={16} aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <p className={`rounded px-3 py-2 text-[12.5px] ${
            d.state === 'offline' ? 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]'
              : d.state === 'stale' ? `bg-[var(--color-caution-soft)] ${CAUTION_TEXT_CLASS}` : 'bg-subtle text-ink-68'}`}>
            {t(`dev.help.${d.state}`)}
          </p>

          <dl className="grid grid-cols-[minmax(110px,auto)_1fr] gap-x-3 gap-y-2.5 text-[12.5px]">
            <dt className="text-ink-46">{t('dev.colHeartbeat')}</dt>
            <dd>{d.last_hb_at ? <><span className="font-medium">{fmtAge(d.last_hb_at, now)}</span> <span className="text-ink-46">· {hbAbs}</span></> : t('dev.never')}</dd>
            <dt className="text-ink-46">{t('dev.colAdapter')}</dt>
            <dd>{t(`dev.adapter.${d.adapterKey}`, { defaultValue: d.adapterKey })}</dd>
            <dt className="text-ink-46">{t('dev.colClock')}</dt>
            <dd>{d.clock_ok == null ? t('dev.clockUnknown') : d.clock_ok ? `✓ ${t('dev.clockOk')}` : <span className={CAUTION_TEXT_CLASS}>◆ {t('dev.clockBad')}</span>}</dd>
            {buffer != null && <>
              <dt className="text-ink-46">{t('dev.bufferLabel')}</dt>
              <dd><span className="font-mono">{buffer}</span> <span className="text-ink-46">{t('dev.bufferHelp')}</span></dd>
            </>}
            <dt className="text-ink-46">{t('dev.colCredential')}</dt>
            <dd>
              <span className="font-mono">v{d.credential_version}</span>
              {d.needs_rotation && d.state !== 'disabled' && <span className={`ml-2 text-[12px] font-semibold ${CAUTION_TEXT_CLASS}`}>◆ {t('dev.keyMissing')}</span>}
              {d.needs_rotation && d.state !== 'disabled' && <p className="mt-0.5 text-[12px] text-ink-46">{t('dev.keyMissingTip')}</p>}
            </dd>
            {siteName && <>
              <dt className="text-ink-46">{t('dev.site')}</dt>
              <dd>{siteName}</dd>
            </>}
            <dt className="text-ink-46">{t('dev.username')}</dt>
            <dd className="flex items-center gap-2"><code className="min-w-0 flex-1 select-all break-all font-mono text-[11.5px]">{d.mqtt_username}</code>
              <CopyButton text={d.mqtt_username} label={t('dev.copyUsername')} /></dd>
            <dt className="text-ink-46">{t('dev.deviceId')}</dt>
            <dd className="flex items-center gap-2"><code className="min-w-0 flex-1 select-all break-all font-mono text-[11.5px]">{d.id}</code>
              <CopyButton text={d.id} label={t('dev.copyId')} /></dd>
          </dl>

          {(abnormal || d.state === 'never') && <Troubleshoot host={location.hostname} edgeId={d.id} className="" />}

          <Link to="/health" className="inline-block text-[12.5px] text-blue hover:underline">{t('dev.toHealth')} →</Link>
        </div>

        <footer className="border-t border-line px-4 py-3">
          {d.state === 'disabled' ? (
            <p className="text-[12px] text-ink-46">{t('dev.disabledFinal')}</p>
          ) : admin ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={onRotate}><KeyRound size={14} aria-hidden /> {t('dev.rotate')}</button>
              <span className="flex-1" />
              <button type="button" className="btn btn-ghost text-[var(--color-danger)]" disabled={busy} onClick={onDisable}><Power size={14} aria-hidden /> {t('dev.disable')}</button>
            </div>
          ) : (
            <p className="text-[12px] text-ink-46">{t('dev.needAdmin')}</p>
          )}
        </footer>
      </div>
    </div>
  );
}
