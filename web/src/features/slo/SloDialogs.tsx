// SLO editor and corrections UI (admin/owner). Native <dialog>: Esc and
// backdrop click close, focus is trapped by the browser. CorrectionsBody is
// shared by the dialog (list page) and the detail panel's Corrections tab.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, sloApi, type SloDef } from '../../lib/api';
import { Notice, PermissionNotice } from '../../shared/ui/Feedback';
import { newSloPreset } from './prefs';

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} onClose={onClose} aria-label={title}
      onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}
      className="m-auto w-[min(520px,94vw)] rounded-[6px] border border-line p-0 shadow-pop backdrop:bg-black/40">
      <header className="flex h-11 items-center border-b border-line px-4">
        <h2 className="flex-1 truncate text-[14px] font-semibold">{title}</h2>
        <button type="button" className="grid h-8 w-8 place-items-center rounded hover:bg-subtle" aria-label={t('common.close')} onClick={() => ref.current?.close()}><X size={16} /></button>
      </header>
      <div className="p-4">{children}</div>
    </dialog>
  );
}

export function SloEditor({ org, initial, onSaved, onClose }: {
  org: string; initial: SloDef | null; onSaved: () => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  const tags = useQuery({ queryKey: ['tags'], queryFn: api.tags, staleTime: 60_000 });
  const preset = initial ? null : newSloPreset();
  const [name, setName] = useState(initial?.name ?? '');
  const [tag, setTag] = useState(initial?.tag ?? '');
  const [target, setTarget] = useState(String(initial?.target ?? preset?.target ?? 99.5));
  const [warning, setWarning] = useState(initial ? String(initial.warning) : (preset?.warning != null ? String(preset.warning) : ''));
  const [desc, setDesc] = useState(initial?.description ?? '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const save = () => {
    const tg = Number(target);
    const w = warning.trim() === '' ? undefined : Number(warning);
    if (!name.trim()) return setErr(t('slos.errName'));
    if (!tag) return setErr(t('slos.errTag'));
    if (!(tg > 0 && tg < 100)) return setErr(t('slos.errTarget'));
    if (w !== undefined && !(w >= tg && w <= 100)) return setErr(t('slos.errWarning'));
    setBusy(true);
    const body = { name: name.trim(), tag, target: tg, warning: w, description: desc.trim() };
    (initial ? sloApi.patch(org, initial.id, body) : sloApi.create(org, body))
      .then(onSaved).catch((e: unknown) => { setErr(e instanceof ApiError && e.status === 409 ? t('slos.errDuplicate') : t('slos.errSave')); setBusy(false); });
  };

  return (
    <Modal title={initial ? t('slos.edit') : t('slos.new')} onClose={onClose}>
      <form className="grid gap-3" noValidate onSubmit={(e) => { e.preventDefault(); if (!busy) save(); }}>
        <div className="field">
          <label className="field-label" htmlFor="slo-name">{t('slos.fName')}</label>
          <input id="slo-name" className="input h-8" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="slo-tag">{t('slos.fTag')}</label>
          <select id="slo-tag" className="input h-8" value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">{t('slos.pickTag')}</option>
            {(tags.data ?? []).map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
          </select>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="field">
            <label className="field-label" htmlFor="slo-target">{t('slos.fTarget')}</label>
            <input id="slo-target" className="input num h-8" type="number" step="0.01" min="0" max="99.999" value={target} onChange={(e) => setTarget(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="slo-warn">{t('slos.fWarning')}</label>
            <input id="slo-warn" className="input num h-8" type="number" step="0.01" max="100" value={warning} placeholder={t('slos.warnAuto')} onChange={(e) => setWarning(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="slo-desc">{t('slos.fDesc')}</label>
          <textarea id="slo-desc" className="input min-h-16" value={desc} maxLength={500} onChange={(e) => setDesc(e.target.value)} />
        </div>
        {err && <Notice tone="error">{err}</Notice>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('control.cancel')}</button>
          <button type="submit" className="btn" aria-disabled={busy || undefined}>{t('slos.save')}</button>
        </div>
      </form>
    </Modal>
  );
}

const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

/** Correction list + (for admins) the add/remove controls. Rendered inside
 *  the modal on the list page and as the Corrections tab of the panel. */
export function CorrectionsBody({ org, slo, admin, onChanged }: {
  org: string; slo: SloDef; admin: boolean; onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [from, setFrom] = useState(() => localInput(new Date(Date.now() - 3600e3)));
  const [to, setTo] = useState(() => localInput(new Date()));
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');

  const add = () => {
    if (!reason.trim()) return setErr(t('slos.errReason'));
    const a = new Date(from); const b = new Date(to);
    if (!(b > a)) return setErr(t('slos.errWindow'));
    sloApi.addCorrection(org, slo.id, { starts_at: a.toISOString(), ends_at: b.toISOString(), reason: reason.trim() })
      .then(() => { setReason(''); setErr(''); onChanged(); }).catch(() => setErr(t('slos.errSave')));
  };

  return (
    <div>
      <p className="mb-3 text-[12px] text-ink-68">{t('slos.correctionsHelp')}</p>
      {slo.corrections.length === 0 ? <p className="mb-3 text-[12px] italic text-ink-46">{t('slos.noCorrections')}</p> : (
        <ul className="mb-3 divide-y divide-line rounded border border-line">
          {slo.corrections.map((c) => (
            <li key={c.id} className="flex items-start gap-2 px-3 py-2 text-[12px]">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{c.reason}</p>
                <p className="font-mono text-ink-68">{new Date(c.starts_at).toLocaleString()} → {new Date(c.ends_at).toLocaleString()}</p>
              </div>
              {admin && (
                <button type="button" className="grid h-7 w-7 place-items-center rounded text-[var(--color-danger)] hover:bg-subtle" aria-label={t('slos.removeCorrection')}
                  onClick={() => sloApi.deleteCorrection(org, slo.id, c.id).then(onChanged).catch(() => setErr(t('slos.errSave')))}><Trash2 size={14} /></button>
              )}
            </li>
          ))}
        </ul>
      )}
      {admin ? (
        <form className="grid gap-3" noValidate onSubmit={(e) => { e.preventDefault(); add(); }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="field">
              <label className="field-label" htmlFor="cor-from">{t('slos.cFrom')}</label>
              <input id="cor-from" className="input h-8" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="cor-to">{t('slos.cTo')}</label>
              <input id="cor-to" className="input h-8" type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="cor-reason">{t('slos.cReason')}</label>
            <input id="cor-reason" className="input h-8" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder={t('slos.cReasonPh')} />
          </div>
          {err && <Notice tone="error">{err}</Notice>}
          <div className="flex justify-end"><button type="submit" className="btn">{t('slos.addCorrection')}</button></div>
        </form>
      ) : <PermissionNotice role="admin" />}
    </div>
  );
}

