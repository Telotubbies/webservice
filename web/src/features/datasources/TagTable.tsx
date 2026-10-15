// Tags of one source: inline add/edit, live value + quality, CSV paste dialog,
// OPC UA browser. Read-only for non-admins.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { Confirm } from '../../shared/ui/Confirm';
import { EmptyState, ErrorState, Notice, SkeletonRows } from '../../shared/ui/Feedback';
import { dsApi, fieldError, type DataSource, type SourceTag } from './api';
import {
  addressInput, addressPlaceholder, CSV_COLUMNS, csvErrorsFromBody, formatAddress, liveKey, parseTagCsv,
  type CsvRowError, type TagType,
} from './logic';
import { OpcBrowser } from './OpcBrowser';
import './i18n';

interface Draft { line: string; device: string; signal: string; address: string; type: TagType; unit: string; writable: boolean; min: string; max: string; scale: string }
const EMPTY: Draft = { line: '', device: '', signal: '', address: '', type: 'number', unit: '', writable: false, min: '', max: '', scale: '' };
const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));
const fromTag = (x: SourceTag): Draft => ({
  line: x.line ?? '', device: x.device ?? '', signal: x.name, address: formatAddress(x.address), type: x.type, unit: x.unit ?? '',
  writable: x.writable, min: x.min == null ? '' : String(x.min), max: x.max == null ? '' : String(x.max), scale: x.scale == null ? '' : String(x.scale),
});

export function TagTable({ orgId, edgeId, source, siteCode, canEdit }: {
  orgId: string; edgeId: string; source: DataSource; siteCode: string; canEdit: boolean;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const key = ['ds-tags', orgId, edgeId, source.id];
  const tags = useQuery({ queryKey: key, queryFn: () => dsApi.tags(orgId, edgeId, source.id), refetchInterval: 10_000 });
  const live = useQuery({ queryKey: ['tags-latest'], queryFn: api.latestAll, refetchInterval: 3000, retry: false });
  const liveMap = useMemo(() => new Map((live.data ?? []).map((v) => [v.name, v])), [live.data]);

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [fe, setFe] = useState<{ field: string; message: string } | null>(null);
  const [msg, setMsg] = useState('');
  const [del, setDel] = useState<SourceTag | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [browse, setBrowse] = useState(false);

  const refresh = () => { void qc.invalidateQueries({ queryKey: key }); void qc.invalidateQueries({ queryKey: ['ds-sources', orgId, edgeId] }); };
  const explain = (e: unknown) => {
    if (e instanceof ApiError) {
      if (e.status === 409) {
        const b = e.body as { detail?: string; referrers?: { kind: string; name?: string }[] } | null;
        if (b?.detail === 'tag_in_use') return t('ds.tagInUse', { by: (b.referrers ?? []).map((r) => r.name ?? r.kind).join(', ') });
        return t('ds.tagExists');
      }
      if (e.status === 403) return t('ds.needAdmin');
      return t('ds.errGeneric', { reason: e.message });
    }
    return t('dev.errNetwork');
  };
  const onErr = (e: unknown) => { const f = fieldError(e); setFe(f); setMsg(f ? '' : explain(e)); };
  const payload = (d: Draft) => ({
    address: addressInput(d.address), type: d.type, unit: d.unit.trim() || null, writable: d.writable,
    min: numOrNull(d.min), max: numOrNull(d.max), scale: numOrNull(d.scale),
  });

  const create = useMutation({
    mutationFn: () => dsApi.createTag(orgId, edgeId, source.id, { line: draft.line, device: draft.device, signal: draft.signal, ...payload(draft) } as never),
    onSuccess: () => { setDraft(EMPTY); setFe(null); setMsg(''); refresh(); },
    onError: onErr,
  });
  const patch = useMutation({
    mutationFn: (id: string) => dsApi.patchTag(orgId, edgeId, source.id, id, payload(draft)),
    onSuccess: () => { setEditing(null); setFe(null); setMsg(''); refresh(); },
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: (x: SourceTag) => dsApi.deleteTag(orgId, edgeId, source.id, x.id),
    onSuccess: () => { setDel(null); setMsg(''); refresh(); },
    onError: (e) => { setDel(null); onErr(e); },
  });

  const rows = tags.data?.items ?? [];
  const addReady = draft.line.trim() && draft.device.trim() && draft.signal.trim() && draft.address.trim();
  const upd = (k: keyof Draft, v: string | boolean) => { setDraft((d) => ({ ...d, [k]: v })); setFe(null); };
  const cell = 'px-2 py-1';
  const errFor = (k: string) => fe && fe.field === k ? fe.message : null;
  const small = 'input h-7 w-full text-[12px]';

  const inputs = (isEdit: boolean) => (
    <>
      {!isEdit && ['line', 'device', 'signal'].map((k) => (
        <td key={k} className={cell}><input aria-label={t(`ds.f_${k}`)} className={small} value={draft[k as 'line']} onChange={(e) => upd(k as 'line', e.target.value)} placeholder={t(`ds.f_${k}`)} aria-invalid={!!errFor(k) || undefined} /></td>
      ))}
      {isEdit && <td className={`${cell} font-mono text-[12px]`} colSpan={3}>{editing ? rows.find((r) => r.id === editing)?.path : ''}</td>}
      <td className={cell}>
        <input aria-label={t('ds.f_address')} className={`${small} font-mono`} value={draft.address} onChange={(e) => upd('address', e.target.value)}
          placeholder={addressPlaceholder(source.protocol, draft.type)} aria-invalid={!!errFor('address') || undefined} />
      </td>
      <td className={cell}>
        <select aria-label={t('ds.f_type')} className={small} value={draft.type} onChange={(e) => upd('type', e.target.value)}>
          <option value="number">{t('ds.type_number')}</option><option value="bool">{t('ds.type_bool')}</option>
        </select>
      </td>
      <td className={cell}><input aria-label={t('ds.f_unit')} className={`${small} w-16`} value={draft.unit} onChange={(e) => upd('unit', e.target.value)} /></td>
      <td className={cell}><input type="checkbox" aria-label={t('ds.f_writable')} checked={draft.writable} onChange={(e) => upd('writable', e.target.checked)} /></td>
      {(['min', 'max', 'scale'] as const).map((k) => (
        <td key={k} className={cell}><input aria-label={t(`ds.f_${k}`)} type="number" step="any" className={`${small} w-16`} value={draft[k]} onChange={(e) => upd(k, e.target.value)} aria-invalid={!!errFor(k) || undefined} /></td>
      ))}
      <td className={cell} />
    </>
  );

  return (
    <div className="mt-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[14px] font-semibold">{t('ds.tagsOf', { name: source.name })}</h3>
        {canEdit && (
          <div className="flex gap-2">
            {source.protocol === 'opcua' && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setBrowse(true)}>{t('ds.browse')}</button>}
            {source.protocol !== 'sim' && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setCsvOpen(true)}><Upload size={13} aria-hidden /> {t('ds.csvPaste')}</button>}
          </div>
        )}
      </div>
      {msg && <div className="mb-2"><Notice tone="error">{msg}</Notice></div>}
      {fe && !['line', 'device', 'signal', 'address', 'type', 'unit', 'min', 'max', 'scale'].includes(fe.field) && <div className="mb-2"><Notice tone="error">{fe.field}: {fe.message}</Notice></div>}
      {fe && ['line', 'device', 'signal', 'address', 'type', 'min', 'max', 'scale'].includes(fe.field) && (
        <p role="alert" className="mb-2 text-[12px] text-[var(--color-danger)]">{t(`ds.f_${fe.field}`)}: {fe.message}</p>
      )}

      {tags.isError ? <ErrorState onRetry={() => void tags.refetch()} /> : tags.isLoading ? <SkeletonRows rows={4} /> : (
        <div className="overflow-x-auto rounded-[5px] border border-line bg-white">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-left">
                {['colLine', 'colDevice', 'colSignal', 'colAddress', 'colType', 'colUnit', 'colWritable', 'colMin', 'colMax', 'colScale', 'colValue', ''].map((c) => (
                  <th key={c || 'act'} scope="col" className="h-8 whitespace-nowrap px-2 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-68">{c && t(`ds.${c}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => {
                const lv = liveMap.get(liveKey(siteCode, x.path));
                return editing === x.id ? (
                  <tr key={x.id} className="border-b border-line bg-info-soft">
                    {inputs(true)}
                    <td className={`${cell} whitespace-nowrap`}>
                      <button type="button" className="btn btn-sm" disabled={patch.isPending || !draft.address.trim()} onClick={() => patch.mutate(x.id)}>{t('ds.saveChanges')}</button>{' '}
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setEditing(null); setFe(null); }}>{t('ds.cancel')}</button>
                    </td>
                  </tr>
                ) : (
                  <tr key={x.id} className="border-b border-line last:border-0">
                    <td className={cell}>{x.line}</td><td className={cell}>{x.device}</td><td className={cell}>{x.name}</td>
                    <td className={`${cell} font-mono text-[12px]`}>{formatAddress(x.address)}</td>
                    <td className={cell}>{t(`ds.type_${x.type}`)}</td><td className={cell}>{x.unit}</td>
                    <td className={cell}>{x.writable ? '✓' : ''}</td>
                    <td className={cell}>{x.min ?? ''}</td><td className={cell}>{x.max ?? ''}</td><td className={cell}>{x.scale ?? ''}</td>
                    <td className={`${cell} whitespace-nowrap font-mono text-[12px]`}>
                      {lv ? <span title={lv.ts}>{String(lv.v)} <span className={lv.q === 'good' ? 'text-ink-46' : 'font-semibold text-[var(--color-danger)]'}>{lv.q === 'good' ? '●' : `▲ ${lv.q}`}</span></span> : <span className="text-ink-35">{t('ds.noValue')}</span>}
                    </td>
                    <td className={`${cell} whitespace-nowrap`}>
                      {canEdit && (
                        <>
                          <button type="button" className="btn btn-sm btn-ghost" aria-label={`${t('ds.edit')} ${x.path}`} onClick={() => { setEditing(x.id); setDraft(fromTag(x)); setFe(null); setMsg(''); }}><Pencil size={12} aria-hidden /></button>{' '}
                          <button type="button" className="btn btn-sm btn-ghost text-[var(--color-danger)]" aria-label={`${t('ds.delete')} ${x.path}`} onClick={() => setDel(x)}><Trash2 size={12} aria-hidden /></button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
              {canEdit && !editing && (
                <tr className="bg-subtle">
                  {inputs(false)}
                  <td className={cell} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && !editing && (
        <div className="mt-2">
          <button type="button" className="btn btn-sm" disabled={!addReady || create.isPending} onClick={() => create.mutate()}><Plus size={13} aria-hidden /> {t('ds.addTag')}</button>
        </div>
      )}
      {!tags.isLoading && rows.length === 0 && !tags.isError && <div className="mt-2"><EmptyState compact icon="info" title={t('ds.noTags')} body={canEdit ? t('ds.noTagsHint') : undefined} /></div>}

      {browse && <OpcBrowser orgId={orgId} edgeId={edgeId} sourceId={source.id} onClose={() => setBrowse(false)} onAdded={() => { setBrowse(false); refresh(); }} />}
      {csvOpen && <CsvDialog orgId={orgId} edgeId={edgeId} source={source} onClose={() => setCsvOpen(false)} onDone={() => { setCsvOpen(false); refresh(); }} />}
      {del && (
        <Confirm title={t('ds.deleteTagTitle', { path: del.path })} body={t('ds.deleteTagBody')} confirm={t('ds.delete')}
          onYes={() => remove.mutate(del)} onNo={() => setDel(null)} />
      )}
    </div>
  );
}

function CsvDialog({ orgId, edgeId, source, onClose, onDone }: {
  orgId: string; edgeId: string; source: DataSource; onClose: () => void; onDone: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<CsvRowError[]>([]);
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);

  const submit = async () => {
    setOther('');
    const local = parseTagCsv(text);
    if (local.errors.length) { setErrors(local.errors); return; }
    setErrors([]); setBusy(true);
    try {
      await dsApi.bulkTags(orgId, edgeId, source.id, text);
      onDone();
    } catch (e) {
      const rows = e instanceof ApiError ? csvErrorsFromBody(e.body) : null;
      if (rows) setErrors(rows); else setOther(e instanceof ApiError ? t('ds.errGeneric', { reason: e.message }) : t('dev.errNetwork'));
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={t('ds.csvTitle')}>
      <div className="max-h-full w-full max-w-3xl overflow-auto rounded-[5px] bg-white p-4 shadow-card">
        <h2 className="text-[15px] font-semibold">{t('ds.csvTitle')}</h2>
        <p className="mt-1 text-[12px] text-ink-68">{t('ds.csvHelp')}</p>
        <p className="mt-1 font-mono text-[12px]">{CSV_COLUMNS.join(',')}</p>
        <p className="mt-1 font-mono text-[12px] text-ink-46">sort,motor1,speed_sp,{addressPlaceholder(source.protocol)},number,Hz,true,0,60,0.1</p>
        <textarea ref={ref} className="input mt-2 h-48 w-full font-mono text-[12px]" value={text} onChange={(e) => { setText(e.target.value); setErrors([]); }} aria-label={t('ds.csvTitle')} spellCheck={false} />
        {errors.length > 0 && (
          <div role="alert" className="mt-2 max-h-40 overflow-auto rounded border border-[var(--color-danger)] bg-[var(--color-danger-soft)] p-2 text-[12px]">
            <p className="font-semibold">{t('ds.csvErrors', { count: errors.length })}</p>
            <ul className="mt-1 list-disc pl-4">{errors.map((r, i) => <li key={i}>{t('ds.rowErr', { row: r.row, field: r.field, message: r.message })}</li>)}</ul>
          </div>
        )}
        {other && <div className="mt-2"><Notice tone="error">{other}</Notice></div>}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('ds.cancel')}</button>
          <button type="button" className="btn" disabled={!text.trim() || busy} onClick={() => void submit()}>{busy ? t('ds.loading') : t('ds.csvImport')}</button>
        </div>
      </div>
    </div>
  );
}
