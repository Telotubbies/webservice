// Guarded write confirmation (FR-C6, doc 16 §1). Native <dialog>: focus is
// trapped and returned by the browser; Escape cancels. The operator types a
// short word to arm the button, so a stray click or Enter can never send.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../shared/ui/Icon';

export interface PendingCommand {
  tag: string;
  label: string;
  from: string;
  to: string;
  kind: 'start' | 'stop' | 'write';
}

export function ConfirmCommand({ pending, onConfirm, onCancel }: {
  pending: PendingCommand | null; onConfirm: () => void; onCancel: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState('');
  const word = pending?.kind === 'stop' ? 'STOP' : pending?.kind === 'start' ? 'START' : 'SET';

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (pending && !d.open) {
      setTyped('');
      d.showModal();
    } else if (!pending && d.open) {
      d.close();
    }
  }, [pending]);

  const armed = typed.trim().toUpperCase() === word;
  const danger = pending?.kind === 'stop';
  const title = pending?.kind === 'stop' ? t('control.confirmStopTitle')
    : pending?.kind === 'start' ? t('control.confirmStartTitle') : t('control.confirmWriteTitle');
  const consequence = pending?.kind === 'stop' ? t('control.stopConsequence')
    : pending?.kind === 'start' ? t('control.startConsequence') : t('control.writeConsequence');

  return (
    <dialog
      ref={ref}
      className="dialog confirm-command"
      aria-labelledby="confirm-title"
      onCancel={(e) => { e.preventDefault(); onCancel(); }}
    >
      {pending && (
        <form method="dialog" onSubmit={(e) => { e.preventDefault(); if (armed) onConfirm(); }}>
          <div className="dialog-head">
            {danger && <Icon name="warn" size={24} className="danger-icon" />}
            <h2 id="confirm-title">{title}</h2>
          </div>
          <div className="dialog-body">
            <dl className="change-row">
              <dt>{t('control.tag')}</dt><dd>{pending.label}</dd>
              <dt>{t('control.from')}</dt><dd>{pending.from}</dd>
              <dt>{t('control.to')}</dt><dd>{pending.to}</dd>
            </dl>
            <p className={`consequence${danger ? ' is-danger' : ''}`}>{consequence}</p>
            <label className="field">
              <span className="field-label">{t('control.typeToConfirm', { word })}</span>
              <input
                className="input num confirm-input"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off" spellCheck={false} autoFocus
                aria-describedby="plc-final"
              />
            </label>
            <p id="plc-final" className="hint">{t('control.plcFinal')}</p>
          </div>
          <div className="dialog-actions">
            <button type="button" className="btn btn-ghost" onClick={onCancel}>{t('control.cancel')}</button>
            <button type="submit" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={!armed}>
              {t('control.confirm')}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
