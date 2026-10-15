// Add / edit a data source: protocol -> connection -> test -> save.
// Test must pass, or the user explicitly picks "Save without testing".

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { ApiError } from '../../lib/api';
import { Notice } from '../../shared/ui/Feedback';
import { dsApi, fieldError, type DataSource, type TestResult } from './api';
import { addressPlaceholder, opcuaIssues, PROTOCOLS, type Protocol, type TagType } from './logic';
import './i18n';

type Form = Record<string, string>;

const DEFAULTS: Record<Protocol, Form> = {
  sim: {},
  modbus: { host: '', port: '502', unit_id: '1', timeout_ms: '2000' },
  s7: { host: '', rack: '0', slot: '1', timeout_ms: '2000' },
  opcua: { endpoint: 'opc.tcp://', security: 'none', auth: 'anonymous' },
};
const NUMERIC = new Set(['port', 'unit_id', 'rack', 'slot', 'timeout_ms']);
const FIELDS: Record<Protocol, string[]> = {
  sim: [], modbus: ['host', 'port', 'unit_id', 'timeout_ms'], s7: ['host', 'rack', 'slot', 'timeout_ms'],
  opcua: ['endpoint', 'security', 'auth'],
};

const toForm = (c: Record<string, unknown>): Form =>
  Object.fromEntries(Object.entries(c).map(([k, v]) => [k, String(v)]));
const toConn = (f: Form): Record<string, unknown> =>
  Object.fromEntries(Object.entries(f).map(([k, v]) => [k, NUMERIC.has(k) && v.trim() !== '' ? Number(v) : v.trim()]));

export function SourceWizard({ orgId, edgeId, existing, onDone, onCancel }: {
  orgId: string; edgeId: string; existing?: DataSource; onDone: (s: DataSource) => void; onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState<0 | 1 | 2>(existing ? 1 : 0);
  const [protocol, setProtocol] = useState<Protocol>(existing?.protocol ?? 'modbus');
  const [name, setName] = useState(existing?.name ?? '');
  const [form, setForm] = useState<Form>(existing ? toForm(existing.connection) : DEFAULTS.modbus);
  const [pollMs, setPollMs] = useState(String(existing?.poll_ms ?? 1000));
  const [probeAddr, setProbeAddr] = useState('');
  const [probeType, setProbeType] = useState<TagType>('number');
  const [result, setResult] = useState<TestResult | null>(null);
  const [err, setErr] = useState<{ field: string; message: string } | null>(null);
  const [fail, setFail] = useState('');

  const pickProtocol = (p: Protocol) => { setProtocol(p); setForm(DEFAULTS[p]); setResult(null); };
  const set = (k: string, v: string) => { setForm((f) => ({ ...f, [k]: v })); setResult(null); setErr(null); };
  const issues = protocol === 'opcua' ? opcuaIssues(form) : [];
  const connValid = (protocol === 'sim' || FIELDS[protocol].every((k) => form[k]?.trim())) && name.trim() !== '' && issues.length === 0;

  const explain = (e: unknown): string => {
    if (e instanceof ApiError) {
      if (e.status === 504) return t('ds.errTimeout');
      if (e.status === 502) return t('ds.errEdge');
      if (e.status === 409) return t('ds.errNameExists');
      if (e.status === 403) return t('ds.needAdmin');
      return t('ds.errGeneric', { reason: e.message });
    }
    return t('dev.errNetwork');
  };

  const test = useMutation({
    mutationFn: () => dsApi.test(orgId, edgeId, {
      protocol, connection: toConn(form),
      tags: probeAddr.trim() ? [{ path: 'probe/test/value', type: probeType, address: probeAddr.trim() }] : [],
    }),
    onSuccess: (r) => { setResult(r); setFail(''); setErr(null); },
    onError: (e) => { setResult(null); const f = fieldError(e); setErr(f); setFail(f ? '' : explain(e)); },
  });
  const save = useMutation({
    mutationFn: () => existing
      ? dsApi.patchSource(orgId, edgeId, existing.id, { name: name.trim(), connection: toConn(form), poll_ms: Number(pollMs) })
      : dsApi.createSource(orgId, edgeId, { name: name.trim(), protocol, connection: toConn(form), poll_ms: Number(pollMs) }),
    onSuccess: (r) => onDone(r.source),
    onError: (e) => { const f = fieldError(e); setErr(f); setFail(f ? '' : explain(e)); },
  });

  const fieldMsg = (k: string) => err && (err.field === k || err.field === `connection.${k}`) ? err.message : null;
  const input = (k: string, opts: { type?: string; ph?: string } = {}) => (
    <div key={k}>
      <label className="field-label" htmlFor={`ds-${k}`}>{t(`ds.f_${k}`)}</label>
      <input id={`ds-${k}`} className="input h-8 w-full" type={opts.type ?? 'text'} value={form[k] ?? ''} placeholder={opts.ph}
        aria-invalid={!!fieldMsg(k) || undefined} aria-describedby={fieldMsg(k) ? `ds-${k}-e` : undefined}
        onChange={(e) => set(k, e.target.value)} />
      {fieldMsg(k) && <p id={`ds-${k}-e`} className="mt-0.5 text-[12px] text-[var(--color-danger)]">{fieldMsg(k)}</p>}
    </div>
  );
  const nameErr = err?.field === 'name' ? err.message : null;
  const testOk = result?.ok === true;
  const detail = result ? (result.detail === 'no_tags_to_test' ? t('ds.noProbe') : result.detail) : '';

  return (
    <section className="rounded-[5px] border border-line bg-white p-4" aria-label={t('ds.wizardTitle')}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">{existing ? t('ds.editSource') : t('ds.addSource')}</h2>
        <ol className="flex gap-3 text-[12px] text-ink-46" aria-label={t('ds.steps')}>
          {(['stepProtocol', 'stepConnection', 'stepTest'] as const).map((k, i) => (
            <li key={k} aria-current={step === i ? 'step' : undefined} className={step === i ? 'font-semibold text-ink' : ''}>{i + 1}. {t(`ds.${k}`)}</li>
          ))}
        </ol>
      </div>

      {step === 0 && (
        <div>
          <div role="radiogroup" aria-label={t('ds.stepProtocol')} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {PROTOCOLS.map((p) => (
              <label key={p} className={`cursor-pointer rounded-[5px] border p-3 ${protocol === p ? 'border-blue bg-info-soft' : 'border-line hover:border-line-hard'}`}>
                <input type="radio" name="ds-protocol" className="sr-only" checked={protocol === p} onChange={() => pickProtocol(p)} />
                <span className="block text-[13px] font-semibold">{t(`ds.proto_${p}`)}</span>
                <span className="block text-[12px] text-ink-68">{t(`ds.protoHint_${p}`)}</span>
              </label>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn" onClick={() => setStep(1)}>{t('ds.next')}</button>
            <button type="button" className="btn btn-ghost" onClick={onCancel}>{t('ds.cancel')}</button>
          </div>
        </div>
      )}

      {step === 1 && (
        <form onSubmit={(e) => { e.preventDefault(); if (connValid) setStep(2); }}>
          {protocol === 's7' && <div className="mb-3"><Notice tone="warn">{t('ds.s7Notice')}</Notice></div>}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="ds-name">{t('ds.f_name')}</label>
              <input id="ds-name" className="input h-8 w-full" value={name} maxLength={120} onChange={(e) => { setName(e.target.value); setErr(null); }} aria-invalid={!!nameErr || undefined} />
              {nameErr && <p className="mt-0.5 text-[12px] text-[var(--color-danger)]">{nameErr}</p>}
            </div>
            <div>
              <label className="field-label" htmlFor="ds-poll">{t('ds.f_poll_ms')}</label>
              <input id="ds-poll" className="input h-8 w-full" type="number" min={100} max={60000} step={100} value={pollMs} onChange={(e) => setPollMs(e.target.value)} />
            </div>
            {protocol === 'modbus' && ['host', 'port', 'unit_id', 'timeout_ms'].map((k) => input(k, { type: k === 'host' ? 'text' : 'number', ph: k === 'host' ? '192.168.0.10' : undefined }))}
            {protocol === 's7' && ['host', 'rack', 'slot', 'timeout_ms'].map((k) => input(k, { type: k === 'host' ? 'text' : 'number', ph: k === 'host' ? '192.168.0.1' : undefined }))}
            {protocol === 'opcua' && (
              <>
                {input('endpoint', { ph: 'opc.tcp://192.168.0.5:4840' })}
                <div>
                  <label className="field-label" htmlFor="ds-security">{t('ds.f_security')}</label>
                  <select id="ds-security" className="input h-8 w-full" value={form.security} onChange={(e) => set('security', e.target.value)}>
                    <option value="none">{t('ds.sec_none')}</option>
                    <option value="sign">{t('ds.sec_sign')}</option>
                    <option value="signencrypt">{t('ds.sec_signencrypt')}</option>
                  </select>
                </div>
                <div>
                  <label className="field-label" htmlFor="ds-auth">{t('ds.f_auth')}</label>
                  <select id="ds-auth" className="input h-8 w-full" value={form.auth} onChange={(e) => set('auth', e.target.value)}>
                    <option value="anonymous">{t('ds.auth_anonymous')}</option>
                    <option value="user" disabled={form.security === 'none'}>{t('ds.auth_user')}</option>
                  </select>
                </div>
              </>
            )}
          </div>
          {issues.map((i) => <div key={i} className="mt-3"><Notice tone="warn">{t(`ds.issue_${i}`)}</Notice></div>)}
          {fail && <div className="mt-3"><Notice tone="error">{fail}</Notice></div>}
          <div className="mt-3 flex gap-2">
            {!existing && <button type="button" className="btn btn-ghost" onClick={() => setStep(0)}>{t('ds.back')}</button>}
            <button type="submit" className="btn" disabled={!connValid}>{t('ds.next')}</button>
            <button type="button" className="btn btn-ghost" onClick={onCancel}>{t('ds.cancel')}</button>
          </div>
        </form>
      )}

      {step === 2 && (
        <div>
          {protocol === 'sim' ? <p className="text-[13px] text-ink-68">{t('ds.simNoTest')}</p> : (
            <>
              <p className="text-[13px] text-ink-68">{t('ds.testIntro')}</p>
              {protocol !== 'opcua' && (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <div>
                    <label className="field-label" htmlFor="ds-probe">{t('ds.probeAddr')}</label>
                    <input id="ds-probe" className="input h-8 w-48 font-mono" value={probeAddr} placeholder={addressPlaceholder(protocol, probeType)}
                      onChange={(e) => { setProbeAddr(e.target.value); setResult(null); }} />
                  </div>
                  <select aria-label={t('ds.f_type')} className="input h-8" value={probeType} onChange={(e) => { setProbeType(e.target.value as TagType); setResult(null); }}>
                    <option value="number">{t('ds.type_number')}</option>
                    <option value="bool">{t('ds.type_bool')}</option>
                  </select>
                  {fieldMsg('address') && <p className="text-[12px] text-[var(--color-danger)]">{fieldMsg('address')}</p>}
                </div>
              )}
              <div className="mt-3 flex items-center gap-2">
                <button type="button" className="btn" onClick={() => { setFail(''); test.mutate(); }} disabled={test.isPending}>
                  {test.isPending ? t('ds.testing') : t('ds.testBtn')}
                </button>
              </div>
              {result && (
                <div className="mt-3" aria-live="polite">
                  <Notice tone={testOk ? 'ok' : 'error'}>{testOk ? t('ds.testOk', { detail }) : t('ds.testFail', { detail })}</Notice>
                  {testOk && Array.isArray(result.sample) && result.sample.length > 0 && (
                    <pre className="mt-2 overflow-x-auto rounded border border-line bg-subtle p-2 text-[12px]">{JSON.stringify(result.sample, null, 1)}</pre>
                  )}
                </div>
              )}
              {fail && <div className="mt-3"><Notice tone="error">{fail}</Notice></div>}
            </>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => setStep(1)}>{t('ds.back')}</button>
            <button type="button" className="btn" disabled={save.isPending || (protocol !== 'sim' && !testOk)} onClick={() => save.mutate()}>
              {existing ? t('ds.saveChanges') : t('ds.save')}
            </button>
            {protocol !== 'sim' && !testOk && (
              <button type="button" className="btn btn-ghost" disabled={save.isPending} onClick={() => save.mutate()}>{t('ds.saveUntested')}</button>
            )}
            <button type="button" className="btn btn-ghost" onClick={onCancel}>{t('ds.cancel')}</button>
          </div>
        </div>
      )}
    </section>
  );
}
