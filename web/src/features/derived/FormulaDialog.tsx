// Calculated-tag editor: pick variables from site tags, write a formula, see
// the result computed from the live values while typing. Validation runs on the
// server (the one place the language is implemented) with a 300 ms debounce.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiError, adminApi, derivedApi, type DerivedTag, type FormulaError, type FormulaPreview } from '../../lib/api';
import { Notice } from '../../shared/ui/Feedback';
import { QualityMark } from '../../shared/ui/Status';
import { DdIcon } from '../../shared/ui/DdIcon';
import './i18n';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const TEMPLATES: { key: string; expr: string; vars: number }[] = [
  { key: 'movavg', expr: 'avg(a, 5m)', vars: 1 },
  { key: 'diff', expr: 'a - b', vars: 2 },
  { key: 'rate', expr: 'rate(a, 1m)', vars: 1 },
  { key: 'scale', expr: 'a * 1', vars: 1 },
  { key: 'either', expr: 'a or b', vars: 2 },
];

interface Row { name: string; tagId: string | null }

/** The server's error code + params -> translated sentence. */
export function useFormulaMessage() {
  const { t } = useTranslation();
  return (e: FormulaError | { code: string }) => {
    const { code, ...rest } = e as FormulaError;
    return t(`calc.err.${code}`, { defaultValue: t('calc.err.generic'), ...rest });
  };
}

function errorOf(e: unknown): FormulaError | { code: string } | null {
  if (!(e instanceof ApiError)) return null;
  const b = e.body as { detail?: string; error?: FormulaError } | null;
  if (b?.error) return b.error;
  if (e.status === 409 || e.status === 422) return { code: b?.detail === 'invalid_path' ? 'path' : (b?.detail ?? 'generic') };
  return null;
}

function TagPicker({ tags, value, onChange, label }: {
  tags: { id: string; path: string; unit?: string }[]; value: string | null; onChange: (id: string) => void; label: string;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const selected = tags.find((x) => x.id === value);
  const hits = useMemo(() => {
    const n = q.trim().toLowerCase();
    return tags.filter((x) => !n || x.path.toLowerCase().includes(n)).slice(0, 8);
  }, [tags, q]);
  const listId = useId();
  return (
    <div className="relative min-w-0 flex-1">
      <input
        className="input h-8 w-full font-mono text-[12px]" role="combobox" aria-expanded={open} aria-controls={listId} aria-label={label}
        placeholder={t('calc.pickTag')} value={open ? q : (selected?.path ?? '')}
        onFocus={() => { setQ(''); setOpen(true); }} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) { e.preventDefault(); onChange(hits[0].id); setOpen(false); } }}
      />
      {open && (
        <ul id={listId} role="listbox" className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-[5px] border border-line bg-white py-1 text-[12px] shadow-flyout">
          {hits.length === 0 && <li className="px-3 py-1.5 text-ink-46">{t('calc.noMatch')}</li>}
          {hits.map((h) => (
            <li key={h.id} role="option" aria-selected={h.id === value}>
              <button type="button" className="block w-full truncate px-3 py-1.5 text-left font-mono hover:bg-info-soft" onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange(h.id); setOpen(false); }}>{h.path}{h.unit ? <span className="ml-2 text-ink-46">{h.unit}</span> : null}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function FormulaDialog({ orgId, siteId, existing, onClose, onDone }: {
  orgId: string; siteId: string; existing?: DerivedTag; onClose: () => void; onDone: (msg: string) => void;
}) {
  const { t } = useTranslation();
  const message = useFormulaMessage();
  const titleId = useId();
  const [path, setPath] = useState(existing?.path ?? '');
  const [unit, setUnit] = useState(existing?.unit ?? '');
  const [expr, setExpr] = useState(existing?.expr ?? '');
  const [rows, setRows] = useState<Row[]>(() => existing
    ? Object.entries(existing.inputs).map(([name, tagId]) => ({ name, tagId }))
    : [{ name: 'a', tagId: null }]);
  const [preview, setPreview] = useState<FormulaPreview | null>(null);
  const [error, setError] = useState<FormulaError | { code: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const seq = useRef(0);
  const first = useRef<HTMLInputElement>(null);

  const tags = useQuery({ queryKey: ['admin-tags', orgId, siteId], queryFn: () => adminApi.siteTags(orgId, siteId) });
  const list = (tags.data?.items ?? []).filter((x) => x.id !== existing?.id);
  const bound = useMemo(() => Object.fromEntries(rows.filter((r) => r.tagId).map((r) => [r.name, r.tagId as string])), [rows]);

  useEffect(() => { first.current?.focus(); }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  // live validation, debounced
  useEffect(() => {
    if (!expr.trim()) { setPreview(null); setError(null); setChecking(false); return; }
    const mine = ++seq.current;
    setChecking(true);
    const id = setTimeout(() => {
      derivedApi.validate(orgId, siteId, { expr, inputs: bound })
        .then((p) => {
          if (mine !== seq.current) return;
          if (p.ok) { setPreview(p); setError(null); } else { setPreview(null); setError(p.error); }
        })
        .catch((e) => { if (mine === seq.current) { setPreview(null); setError(errorOf(e) ?? { code: 'generic' }); } })
        .finally(() => { if (mine === seq.current) setChecking(false); });
    }, 300);
    return () => clearTimeout(id);
  }, [expr, bound, orgId, siteId]);

  const save = useMutation({
    mutationFn: () => {
      const inputs = bound;
      return existing
        ? derivedApi.update(orgId, siteId, existing.id, { expr, inputs, unit: unit || undefined })
        : derivedApi.create(orgId, siteId, { path: path.trim(), expr, inputs, unit: unit || undefined });
    },
    onSuccess: () => onDone(t(existing ? 'calc.saved' : 'calc.created')),
    onError: (e) => { const x = errorOf(e); if (x) setError(x); },
  });

  const addRow = () => {
    const used = new Set(rows.map((r) => r.name));
    const next = [...LETTERS].find((l) => !used.has(l));
    if (next) setRows([...rows, { name: next, tagId: null }]);
  };
  const applyTemplate = (tp: (typeof TEMPLATES)[number]) => {
    setExpr(tp.expr);
    setRows((cur) => {
      const out = [...cur];
      while (out.length < tp.vars) out.push({ name: LETTERS[out.length], tagId: null });
      return out;
    });
  };
  const pathOk = existing || /^[a-z0-9_]+(\/[a-z0-9_]+){1,7}$/.test(path.trim());
  const canSave = !!preview && pathOk && !save.isPending;
  const errPos = error && 'pos' in error && typeof error.pos === 'number' && error.pos >= 0 ? Math.min(error.pos, expr.length) : null;
  const staleVar = preview?.inputs.find((i) => i.q === 'stale' || i.q === 'bad' || i.q === 'uncertain');

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="max-h-[92vh] w-full max-w-[640px] space-y-4 overflow-auto rounded-[5px] border border-line bg-white p-5 text-[13px] shadow-flyout">
        <h2 id={titleId} className="text-[15px] font-semibold">{t(existing ? 'calc.titleEdit' : 'calc.titleNew')}</h2>

        <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
          <label className="block">
            <span className="mb-1 block text-ink-68">{t('calc.path')}</span>
            <input ref={first} className="input h-8 w-full font-mono text-[12px]" value={path} disabled={!!existing} maxLength={200}
              onChange={(e) => setPath(e.target.value)} placeholder="line1/flow_avg_5m" aria-describedby="calc-path-hint" />
            <span id="calc-path-hint" className="mt-1 block text-[11px] text-ink-46">{t('calc.pathHint')}</span>
          </label>
          <label className="block">
            <span className="mb-1 block text-ink-68">{t('calc.unit')}</span>
            <input className="input h-8 w-full" value={unit} maxLength={32} onChange={(e) => setUnit(e.target.value)} />
          </label>
        </div>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-ink-68">{t('calc.variables')}</legend>
          {rows.map((r) => {
            const shown = preview?.inputs.find((i) => i.var === r.name);
            return (
              <div key={r.name} className="flex items-center gap-2">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded border border-line font-mono font-semibold" aria-hidden>{r.name}</span>
                <TagPicker tags={list} value={r.tagId} label={`${t('calc.variables')} ${r.name}`}
                  onChange={(id) => setRows(rows.map((x) => (x.name === r.name ? { ...x, tagId: id } : x)))} />
                <span className="hidden w-36 shrink-0 items-center gap-1 font-mono text-[12px] text-ink-68 sm:flex">
                  {shown ? (shown.value == null ? <span className="text-ink-46">{t('calc.noValue')}</span> : String(shown.value)) : ''}
                  {shown?.q && <QualityMark q={shown.q as 'good' | 'bad' | 'stale' | 'uncertain'} />}
                </span>
                <button type="button" className="btn btn-sm btn-ghost btn-icon shrink-0" disabled={rows.length === 1}
                  aria-label={t('calc.removeVar', { name: r.name })} onClick={() => setRows(rows.filter((x) => x.name !== r.name))}>
                  <DdIcon name="cancel" size={12} />
                </button>
              </div>
            );
          })}
          <button type="button" className="btn btn-sm btn-ghost" onClick={addRow} disabled={rows.length >= 26}><DdIcon name="plus" size={12} /> {t('calc.addVar')}</button>
        </fieldset>

        <div>
          <label className="mb-1 block text-ink-68" htmlFor="calc-expr">{t('calc.formula')}</label>
          <input id="calc-expr" className={`input h-9 w-full font-mono text-[13px] ${error ? 'border-danger' : ''}`} value={expr} spellCheck={false} autoComplete="off"
            onChange={(e) => setExpr(e.target.value)} placeholder="avg(a - b, 5m)" aria-invalid={!!error} aria-describedby="calc-expr-msg" maxLength={500} />
          {errPos != null && (
            <div className="select-none px-[calc(0.5rem+1px)] font-mono text-[13px] leading-none text-danger" aria-hidden>
              <span className="whitespace-pre">{' '.repeat(errPos)}^</span>
            </div>
          )}
          <p className="mt-1 text-[11px] text-ink-46">{t('calc.formulaHint')}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-ink-46">{t('calc.templates')}</span>
            {TEMPLATES.map((tp) => (
              <button key={tp.key} type="button" className="btn btn-sm btn-ghost" onClick={() => applyTemplate(tp)}>{t(`calc.tpl.${tp.key}`)}</button>
            ))}
          </div>
        </div>

        <div id="calc-expr-msg" className="min-h-[44px]" aria-live="polite">
          {error ? <Notice tone="error">{message(error)}</Notice> : checking && !preview ? <p className="text-ink-46">{t('calc.checking')}</p> : preview ? (
            <div className="rounded-[5px] border border-line bg-subtle px-3 py-2">
              <span className="text-ink-46">{t('calc.preview')} </span>
              <span className="font-mono text-[15px] font-semibold">= {preview.value == null ? '—' : preview.type === 'bool' ? t(preview.value ? 'state.on' : 'state.off') : String(Math.round((preview.value as number) * 1e6) / 1e6)}{unit && preview.type === 'number' ? ` ${unit}` : ''}</span>
              <span className="ml-2 text-success">✓ {t('calc.valid')}</span>
              <span className="ml-2 text-ink-46">· {t(`calc.type.${preview.type}`)}</span>
              {preview.quality && preview.quality !== 'good' && <span className="ml-2"><QualityMark q={preview.quality as 'bad' | 'stale' | 'uncertain'} /></span>}
              {staleVar && <p className="mt-1 text-[12px] text-ink-68">{t('calc.qualityNote', { name: staleVar.var })}</p>}
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('calc.cancel')}</button>
          <button type="button" className="btn" disabled={!canSave} onClick={() => save.mutate()}>{t(existing ? 'calc.save' : 'calc.create')}</button>
        </div>
      </div>
    </div>
  );
}
