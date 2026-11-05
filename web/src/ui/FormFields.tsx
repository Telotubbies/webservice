// Form fields (spec §6.5): a visible label always (never placeholder-as-
// label), hint and error directly under the control (Proximity), the error
// in role=alert and wired with aria-invalid + aria-describedby. Input
// borders use --color-line-strong (≥ 3:1, WCAG 1.4.11).

import { useId, useMemo, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type SelectHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { clampStep, filterOptions, parseNumberField, type Option } from './fields';
import './i18n';

const CONTROL = 'h-8 w-full min-w-0 rounded-control border border-line-strong bg-panel px-2.5 text-[13px] text-ink placeholder:text-ink-3 aria-[invalid=true]:border-crit disabled:bg-panel-2 disabled:text-ink-4';

function Field({ id, label, hint, error, children }: { id: string; label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[12px] font-semibold text-ink-2">{label}</label>
      {children}
      {error ? (
        <p id={`${id}-err`} role="alert" className="flex items-center gap-1 text-[12px] text-[var(--color-danger)]"><span aria-hidden>▲</span>{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[12px] text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
}
const describedBy = (id: string, hint?: ReactNode, error?: ReactNode) => (error ? `${id}-err` : hint ? `${id}-hint` : undefined);

export function Input({ label, hint, error, className = '', ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; hint?: ReactNode; error?: ReactNode }) {
  const id = useId();
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <input id={id} className={`${CONTROL} ${className}`} aria-invalid={!!error || undefined} aria-describedby={describedBy(id, hint, error)} {...rest} />
    </Field>
  );
}

export function Select({ label, hint, error, children, className = '', ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: ReactNode; hint?: ReactNode; error?: ReactNode }) {
  const id = useId();
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <select id={id} className={`${CONTROL} ${className}`} aria-invalid={!!error || undefined} aria-describedby={describedBy(id, hint, error)} {...rest}>{children}</select>
    </Field>
  );
}

/** Number with unit, −/+ steppers and range validation. The draft text is
 *  kept while it is invalid; onChange only ever receives a valid number. */
export function NumberField({ value, onChange, unit, min, max, step = 1, label, hint }: {
  value: number | null; onChange: (v: number) => void; unit?: string; min?: number; max?: number; step?: number; label: ReactNode; hint?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? (value == null ? '' : String(value));
  const parsed = parseNumberField(text, { min, max, locale: i18n.language });
  const error = draft == null || parsed.ok ? undefined
    : parsed.reason === 'empty' ? t('kit.numEmpty') : parsed.reason === 'nan' ? t('kit.numNan')
    : parsed.reason === 'min' ? t('kit.numMin', { min }) : t('kit.numMax', { max });
  const nudge = (dir: 1 | -1) => {
    const next = clampStep((parsed.ok ? parsed.value : value ?? min ?? 0) + dir * step, step, min, max);
    setDraft(null);
    onChange(next);
  };
  const btn = 'grid h-8 w-8 shrink-0 place-items-center border border-line-strong bg-panel-2 text-ink-2 hover:bg-panel disabled:text-ink-4';
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <div className="flex items-stretch">
        <button type="button" className={`${btn} rounded-l-control`} aria-label={t('kit.decrease')} onClick={() => nudge(-1)}
          disabled={min != null && parsed.ok && parsed.value <= min}>−</button>
        <input
          id={id} inputMode="decimal" value={text}
          className={`${CONTROL} rounded-none border-x-0 text-right font-mono tabular-nums`}
          aria-invalid={!!error || undefined} aria-describedby={describedBy(id, hint, error)}
          onChange={(e) => {
            setDraft(e.target.value);
            const p = parseNumberField(e.target.value, { min, max });
            if (p.ok) onChange(p.value);
          }}
          onBlur={() => { if (parsed.ok) setDraft(null); }}
          onKeyDown={(e) => { if (e.key === 'ArrowUp') { e.preventDefault(); nudge(1); } if (e.key === 'ArrowDown') { e.preventDefault(); nudge(-1); } }}
        />
        {unit && <span className="grid place-items-center border-y border-line-strong bg-panel-2 px-2 font-mono text-[12px] text-ink-2">{unit}</span>}
        <button type="button" className={`${btn} rounded-r-control`} aria-label={t('kit.increase')} onClick={() => nudge(1)}
          disabled={max != null && parsed.ok && parsed.value >= max}>+</button>
      </div>
    </Field>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className="inline-flex min-h-8 cursor-pointer items-center gap-2 text-[13px] has-[:disabled]:cursor-not-allowed has-[:disabled]:text-ink-4">
      <button
        type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${checked ? 'border-accent bg-accent' : 'border-line-strong bg-panel-2'} disabled:opacity-50`}
      >
        <span aria-hidden className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-panel shadow-ply1 transition-[left] ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
      {label}
    </label>
  );
}

export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className="inline-flex min-h-8 cursor-pointer items-center gap-2 text-[13px] has-[:disabled]:cursor-not-allowed has-[:disabled]:text-ink-4">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[var(--color-accent)]" />
      {label}
    </label>
  );
}

/** ARIA 1.2 combobox: type to filter (case-insensitive, Thai marks intact),
 *  ↑↓ to move, Enter to pick, Esc to close. */
export function Combobox({ options, value, onChange, placeholder, label }: {
  options: Option[]; value: string | null; onChange: (v: string) => void; placeholder?: string; label: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const listId = `${id}-list`;
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const shown = useMemo(() => filterOptions(options, q, i18n.language), [options, q, i18n.language]);
  const current = options.find((o) => o.value === value);
  const pick = (o: Option) => { onChange(o.value); setQ(''); setOpen(false); };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(shown.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter' && open && shown[active]) { e.preventDefault(); pick(shown[active]); }
    else if (e.key === 'Escape') { setOpen(false); setQ(''); }
  };
  return (
    <Field id={id} label={label}>
      <div className="relative">
        <input
          id={id} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={open && shown[active] ? `${id}-o${active}` : undefined}
          className={CONTROL} placeholder={current?.label ?? placeholder}
          value={open ? q : current?.label ?? ''}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
          onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={onKey}
        />
        {open && (
          <ul id={listId} role="listbox" className="absolute left-0 right-0 top-9 z-30 max-h-60 overflow-y-auto rounded-panel border border-line bg-panel p-1 shadow-ply2">
            {shown.length === 0 && <li className="px-2 py-1.5 text-[12px] text-ink-3">{t('kit.noMatches')}</li>}
            {shown.map((o, i) => (
              <li
                key={o.value} id={`${id}-o${i}`} role="option" aria-selected={o.value === value}
                onMouseDown={(e) => { e.preventDefault(); pick(o); }} onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-[13px] ${i === active ? 'bg-panel-2' : ''}`}
              >
                <span className="w-3 text-accent" aria-hidden>{o.value === value ? '✓' : ''}</span>
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.hint && <span className="truncate font-mono text-[11px] text-ink-3">{o.hint}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Field>
  );
}
