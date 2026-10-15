// Add device wizard: 1 connection type → 2 details → 3 install (provision
// call returns the one-time secret) → 4 wait for the first heartbeat.

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Cable, Check, CircleCheck, Cpu, Download, Factory, LoaderCircle, Network, type LucideIcon } from 'lucide-react';
import { adminApi, type Device } from '../../lib/api';
import { useNow } from '../../lib/hooks';
import { fmtAge, fmtDuration } from '../../lib/format';
import { canAdmin } from '../../app/session';
import { useAdminOrg, useAdminSite } from '../admin/admin';
import { Notice } from '../../shared/ui/Feedback';
import { ProductHeader } from '../../shared/ui/Product';
import { CopyButton, SecretReveal } from './SecretReveal';
import { Troubleshoot } from './Troubleshoot';
import { actionError, dockerRun, downloadText, envFile, OK_TEXT_CLASS, type Adapter } from './devices';

const TYPES: { id: Adapter | 'opcua' | 's7'; icon: LucideIcon; ready: boolean }[] = [
  { id: 'modbus', icon: Cable, ready: true },
  { id: 'sim', icon: Cpu, ready: true },
  { id: 'opcua', icon: Network, ready: false },
  { id: 's7', icon: Factory, ready: false },
];
const READY = TYPES.filter((x) => x.ready).map((x) => x.id as Adapter);
const STEPS = ['type', 'details', 'install', 'verify'] as const;
/** Programmatic focus target only — the global :focus-visible ring would
 *  otherwise box the heading after every step change. */
const NO_RING = { outline: 'none' } as const;
/** After this long without a heartbeat, show the troubleshooting checklist. */
const SLOW_MS = 90_000;
/** Bare host name or IPv4 — no scheme, path or port (MQTT_PORT is fixed 8883). */
const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

export function AddDeviceWizard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const now = useNow();
  const { orgId, orgRole } = useAdminOrg();
  const { site, sites, setSiteId } = useAdminSite(orgId);
  const [step, setStep] = useState(0);
  const [adapter, setAdapter] = useState<Adapter>('modbus');
  const [name, setName] = useState('');
  const [host, setHost] = useState(() => location.hostname);
  const [pollMs, setPollMs] = useState(1000);
  const [tried, setTried] = useState(false);
  const [touched, setTouched] = useState<{ name?: boolean; host?: boolean }>({});
  const [created, setCreated] = useState<{ edge: Device; secret: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [verifyFrom, setVerifyFrom] = useState<number | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusedKey = useRef('0-false'); // skip the initial mount (and StrictMode's re-run)
  const typeRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const provision = useMutation({
    mutationFn: () => adminApi.provisionDevice(orgId!, site!.id, name.trim()),
    onSuccess: (r) => { setCreated(r); setStep(2); },
  });
  // step 4: poll until the new edge reports a heartbeat
  const live = useQuery({
    queryKey: ['device-verify', created?.edge.id],
    queryFn: () => adminApi.devices(orgId!, site!.id),
    enabled: step === 3 && !!created,
    refetchInterval: (q) => (q.state.data?.items.find((d) => d.id === created?.edge.id)?.last_hb_at ? false : 3000),
  });
  const connected = live.data?.items.find((d) => d.id === created?.edge.id)?.last_hb_at;

  // move focus to the new step's heading so keyboard / screen-reader users
  // land on the step they just opened (not on a button that no longer exists)
  useEffect(() => {
    const k = `${step}-${!!connected}`;
    if (focusedKey.current === k) return;
    focusedKey.current = k;
    if (step !== 1) headingRef.current?.focus(); // step 2 autofocuses its name field instead
  }, [step, connected]);

  // the key exists only in this tab: warn before a reload / tab close loses it
  useEffect(() => {
    if (!created || connected) return;
    const guard = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [created, connected]);

  if (orgRole && !canAdmin(orgRole)) {
    return (
      <div className="flex min-h-[calc(100svh-36px)] flex-col">
        <ProductHeader icon="server" title={t('dev.addTitle')} tabs={[{ to: '/infrastructure', label: t('dev.tabDevices'), end: true }]} />
        <div className="mx-auto w-full max-w-[880px] p-4 sm:p-6"><Notice tone="warn">{t('dev.needAdmin')}</Notice>
          <Link to="/infrastructure" className="btn btn-ghost mt-3">{t('dev.toFleet')}</Link></div>
      </div>
    );
  }

  const nameErr = !name.trim() ? t('dev.errName') : name.trim().length > 80 ? t('dev.errNameLong') : '';
  const hostErr = HOST_RE.test(host.trim()) ? '' : t('dev.errHost');
  const hostLocal = /^(localhost|127\.)/.test(host.trim());
  const showNameErr = (tried || touched.name) && !!nameErr;
  const showHostErr = (tried || touched.host) && !!hostErr;
  const provisionErr = provision.error ? actionError(provision.error, t) : '';
  const params = created && orgId && site ? {
    host: host.trim(), orgId, siteId: site.id, edgeId: created.edge.id, username: created.edge.mqtt_username,
    secret: created.secret, adapter, pollMs, siteCode: site.code || 'plant1',
  } : null;
  const elapsed = verifyFrom ? now - verifyFrom : 0;

  // radiogroup roving focus: arrows move between the selectable types
  const onTypeKey = (e: KeyboardEvent) => {
    const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = READY[(READY.indexOf(adapter) + d + READY.length) % READY.length];
    setAdapter(next);
    typeRefs.current[next]?.focus();
  };
  const goVerify = () => { setVerifyFrom((v) => v ?? Date.now()); setStep(3); };

  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader icon="server" title={t('dev.addTitle')} tabs={[{ to: '/infrastructure', label: t('dev.tabDevices'), end: true }]} />
      <div className="mx-auto w-full max-w-[880px] p-4 sm:p-6">
        {/* stepper — every label on desktop; on a phone only the current one + "Step n of 4" */}
        <p className="mb-2 text-[12px] font-semibold text-ink-68 sm:hidden">{t('dev.stepOf', { n: step + 1, total: STEPS.length })}</p>
        <ol className="mb-5 flex items-center gap-2" aria-label={t('dev.progress')}>
          {STEPS.map((s, i) => (
            <li key={s} className={`flex items-center gap-2 ${i < STEPS.length - 1 ? 'flex-1' : ''}`} aria-current={i === step ? 'step' : undefined}>
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[12px] font-semibold ${
                i < step ? 'border-blue bg-white text-blue' : i === step ? 'border-blue bg-blue text-white' : 'border-line bg-subtle text-ink-68'}`}>
                {i < step ? <Check size={14} aria-label={t('dev.stepDone')} /> : i + 1}
              </span>
              <span className={`whitespace-nowrap text-[13px] ${i === step ? 'font-semibold text-ink' : 'hidden text-ink-68 sm:inline'}`}>{t(`dev.step.${s}`)}</span>
              {i < STEPS.length - 1 && <span className={`h-px min-w-3 flex-1 ${i < step ? 'bg-blue' : 'bg-line'}`} aria-hidden />}
            </li>
          ))}
        </ol>

        <section className="rounded-[6px] border border-line bg-white p-4 sm:p-5">
          {step === 0 && (
            <>
              <h2 ref={headingRef} tabIndex={-1} style={NO_RING} className="text-[16px] font-semibold">{t('dev.typeTitle')}</h2>
              <p className="mt-1 text-[13px] text-ink-68">{t('dev.typeBody')}</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={t('dev.typeTitle')} onKeyDown={onTypeKey}>
                {TYPES.map(({ id, icon: Ico, ready }) => {
                  const on = adapter === id;
                  return (
                    <button key={id} type="button" role="radio" aria-checked={on} disabled={!ready} tabIndex={on ? 0 : -1}
                      ref={(el) => { typeRefs.current[id] = el; }}
                      onClick={() => ready && setAdapter(id as Adapter)}
                      className={`flex min-h-[72px] items-start gap-3 rounded border p-4 text-left focus-visible:outline-2 focus-visible:outline-blue disabled:cursor-not-allowed disabled:bg-subtle ${
                        on ? 'border-blue bg-info-soft ring-1 ring-blue' : 'border-line hover:border-ink-35'}`}>
                      <Ico size={22} className={`shrink-0 ${on ? 'text-blue' : 'text-ink-46'}`} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2 text-[14px] font-semibold">{t(`dev.type.${id}.name`)}
                          {!ready && <span className="rounded border border-line bg-white px-1.5 text-[11px] font-semibold text-ink-68">{t('dev.soon')}</span>}
                        </span>
                        <span className={`mt-0.5 block text-[12px] ${ready ? 'text-ink-68' : 'text-ink-46'}`}>{t(`dev.type.${id}.body`)}</span>
                      </span>
                      {on && <CircleCheck size={18} className="shrink-0 text-blue" aria-hidden />}
                    </button>
                  );
                })}
              </div>
              <Footer cancel={t('dev.cancel')} onNext={() => setStep(1)} nextLabel={t('dev.next')} />
            </>
          )}

          {step === 1 && (
            <form noValidate onSubmit={(e) => { e.preventDefault(); setTried(true); if (!nameErr && !hostErr && site) provision.mutate(); }}>
              <h2 ref={headingRef} tabIndex={-1} style={NO_RING} className="text-[16px] font-semibold">{t('dev.detailsTitle')}</h2>
              <p className="mt-1 text-[13px] text-ink-68">
                {t('dev.typeChosen', { type: t(`dev.type.${adapter}.name`) })}{' '}
                <button type="button" className="text-blue underline-offset-2 hover:underline" onClick={() => setStep(0)}>{t('dev.change')}</button>
              </p>

              <Field id="dv-name" label={t('dev.name')} help={t('dev.nameHelp')} error={showNameErr ? nameErr : ''}>
                <input id="dv-name" className="input h-9 w-full" value={name} maxLength={80} autoFocus autoComplete="off"
                  placeholder={t('dev.namePh')} onChange={(e) => setName(e.target.value)} onBlur={() => setTouched((x) => ({ ...x, name: true }))}
                  aria-invalid={showNameErr} aria-describedby={`dv-name-help${showNameErr ? ' dv-name-err' : ''}`} />
              </Field>

              <div className="grid gap-x-3 sm:grid-cols-3">
                <Field id="dv-site" label={t('dev.site')}>
                  <select id="dv-site" className="input h-9 w-full" value={site?.id ?? ''} onChange={(e) => setSiteId(e.target.value)} disabled={sites.length < 2}>
                    {sites.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
                  </select>
                </Field>
                <Field id="dv-host" label={t('dev.broker')} help={hostLocal && !showHostErr ? t('dev.brokerLocal') : t('dev.brokerHelp')} error={showHostErr ? hostErr : ''}
                  warn={hostLocal && !showHostErr}>
                  <input id="dv-host" className="input h-9 w-full font-mono" value={host} autoComplete="off" spellCheck={false} inputMode="url"
                    onChange={(e) => setHost(e.target.value)} onBlur={() => setTouched((x) => ({ ...x, host: true }))}
                    aria-invalid={showHostErr} aria-describedby={`dv-host-help${showHostErr ? ' dv-host-err' : ''}`} />
                </Field>
                <Field id="dv-poll" label={t('dev.pollMs')} help={t('dev.pollHelp')}>
                  <select id="dv-poll" className="input h-9 w-full" value={pollMs} onChange={(e) => setPollMs(Number(e.target.value))} aria-describedby="dv-poll-help">
                    {[500, 1000, 2000, 5000].map((n) => <option key={n} value={n}>{n} ms</option>)}
                  </select>
                </Field>
              </div>
              <p className="mt-4 flex items-start gap-2 rounded bg-subtle px-3 py-2 text-[12.5px] text-ink-68">
                <span aria-hidden className="text-blue">ⓘ</span>{t('dev.createNote')}
              </p>
              {provisionErr && <div className="mt-3"><Notice tone="error">{provisionErr}</Notice></div>}
              <Footer cancel={t('dev.cancel')} onBack={() => setStep(0)} backLabel={t('dev.back')}
                nextLabel={provision.isPending ? t('dev.creating') : t('dev.create')} submit busy={provision.isPending} />
            </form>
          )}

          {step === 2 && params && created && (
            <>
              <h2 ref={headingRef} tabIndex={-1} style={NO_RING} className="text-[16px] font-semibold">{t('dev.installTitle')}</h2>
              <p className={`mt-2 flex items-start gap-2 rounded bg-[var(--color-ok-soft)] px-3 py-2 text-[12.5px] ${OK_TEXT_CLASS}`} role="status">
                <CircleCheck size={16} className="mt-0.5 shrink-0" aria-hidden />{t('dev.createdOk', { name: created.edge.name })}
              </p>
              <ol className="mt-4 space-y-5">
                <InstallStep n={1} title={t('dev.inst.key')}>
                  <SecretReveal username={params.username} secret={params.secret} />
                </InstallStep>
                <InstallStep n={2} title={t('dev.inst.cert')}>
                  <p className="text-[12.5px] text-ink-68">{t('dev.certNote')}</p>
                </InstallStep>
                <InstallStep n={3} title={t('dev.inst.env')}>
                  <Snippet title={t('dev.envFile')} text={envFile(params)} display={envFile({ ...params, secret: '••••••••••••••••' })}
                    note={t('dev.envMasked')} copyLabel={t('dev.copyEnv')}
                    extra={<button type="button" className="inline-flex h-8 items-center gap-1 rounded border border-line-hard bg-white px-2.5 text-[12px] font-medium hover:bg-subtle"
                      onClick={() => downloadText('edge.env', envFile(params))}><Download size={14} aria-hidden /> {t('dev.download')}</button>} />
                </InstallStep>
                {adapter === 'modbus' && (
                  <InstallStep n={4} title={t('dev.inst.tags')}>
                    <p className="text-[12.5px] text-ink-68">{t('dev.modbusNote')}</p>
                  </InstallStep>
                )}
                <InstallStep n={adapter === 'modbus' ? 5 : 4} title={t('dev.inst.run')}>
                  <Snippet title={t('dev.runCmd')} text={dockerRun(params)} copyLabel={t('dev.copyRun')} />
                </InstallStep>
              </ol>
              <label className="mt-5 flex cursor-pointer items-start gap-2 rounded border border-line px-3 py-2.5 text-[13px]">
                <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
                <span>{t('dev.ackSaved')}</span>
              </label>
              <p className="mt-2 text-[12px] text-ink-46">{t('dev.noBack')}</p>
              <Footer onNext={goVerify} nextLabel={t('dev.installedNext')} busy={!saved} />
            </>
          )}

          {step === 3 && created && (
            <div className="py-4 text-center sm:py-6">
              {connected ? (
                <>
                  <CircleCheck size={40} className="mx-auto text-[var(--color-ok)]" aria-hidden />
                  <h2 ref={headingRef} tabIndex={-1} style={NO_RING} className="mt-3 text-[16px] font-semibold" role="status">{t('dev.connected', { name: created.edge.name })}</h2>
                  <p className="mt-1 text-[13px] text-ink-68">{t('dev.connectedBody')}</p>
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    <Link to={`/infrastructure?device=${created.edge.id}`} className="btn">{t('dev.toDevice')}</Link>
                    <Link to="/infrastructure" className="btn btn-ghost">{t('dev.toFleet')}</Link>
                    <Link to="/dashboards" className="btn btn-ghost">{t('dev.toDashboards')}</Link>
                  </div>
                </>
              ) : (
                <>
                  <LoaderCircle size={40} className="mx-auto animate-spin text-blue motion-reduce:animate-none" aria-hidden />
                  <h2 ref={headingRef} tabIndex={-1} style={NO_RING} className="mt-3 text-[16px] font-semibold">{t('dev.waiting')}</h2>
                  <p className="mt-1 text-[13px] text-ink-68">{t('dev.waitingBody')}</p>
                  <p className="mt-2 font-mono text-[12px] text-ink-46" aria-live="off">
                    {t('dev.pollStatus', { elapsed: fmtDuration(new Date(verifyFrom ?? now).toISOString(), now), ago: live.dataUpdatedAt ? fmtAge(new Date(live.dataUpdatedAt).toISOString(), now) : '—' })}
                  </p>
                  {live.isError && <div className="mx-auto mt-3 max-w-[560px] text-left"><Notice tone="warn">{t('dev.pollError')}</Notice></div>}
                  {elapsed > SLOW_MS && params && <Troubleshoot host={params.host} edgeId={created.edge.id} />}
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    <button type="button" className="btn btn-ghost" onClick={() => setStep(2)}><ArrowLeft size={14} aria-hidden /> {t('dev.showInstall')}</button>
                    <button type="button" className="btn btn-ghost" onClick={() => navigate(`/infrastructure?device=${created.edge.id}`)}>{t('dev.finishLater')}</button>
                  </div>
                  <p className="mt-2 text-[12px] text-ink-46">{t('dev.finishLaterNote')}</p>
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** Label + control + helper + inline error, error tied to the field (WCAG 3.3.1). */
function Field({ id, label, help, error, warn, children }: {
  id: string; label: string; help?: string; error?: string; warn?: boolean; children: ReactNode;
}) {
  return (
    <div className="mt-4">
      <label htmlFor={id} className="block text-[12px] font-semibold text-ink-68">{label}</label>
      <div className="mt-1">{children}</div>
      {error
        ? <p id={`${id}-err`} className="mt-1 text-[12px] text-[var(--color-danger)]" role="alert"><span aria-hidden>▲ </span>{error}</p>
        : help && <p id={`${id}-help`} className={`mt-1 text-[12px] ${warn ? 'text-[color-mix(in_srgb,var(--color-caution)_70%,black)]' : 'text-ink-46'}`}>{warn && <span aria-hidden>◆ </span>}{help}</p>}
    </div>
  );
}

function InstallStep({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[24px_1fr] gap-x-3">
      <span className="grid h-6 w-6 place-items-center rounded-full bg-ink text-[12px] font-semibold text-white" aria-hidden>{n}</span>
      <div className="min-w-0">
        <h3 className="mb-2 text-[14px] font-semibold leading-6">{title}</h3>
        {children}
      </div>
    </li>
  );
}

function Snippet({ title, text, display, note, copyLabel, extra }: {
  title: string; text: string; display?: string; note?: string; copyLabel: string; extra?: ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[12px] font-semibold text-ink-68">{title}</span>
        <span className="flex-1" />
        {extra}
        <CopyButton text={text} label={copyLabel} />
      </div>
      {/* dark code surface: the shared code-block colours aren't tokenised yet */}
      <pre className="overflow-x-auto rounded bg-rail p-3 font-mono text-[12px] leading-5 text-white">{display ?? text}</pre>
      {note && <p className="mt-1 text-[11.5px] text-ink-46">{note}</p>}
    </div>
  );
}

function Footer({ cancel, onBack, onNext, backLabel, nextLabel, submit, busy }: {
  cancel?: string; onBack?: () => void; onNext?: () => void; backLabel?: string; nextLabel: string; submit?: boolean; busy?: boolean;
}) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-line pt-4">
      {cancel && <Link to="/infrastructure" className="btn btn-ghost">{cancel}</Link>}
      {onBack && <button type="button" className="btn btn-ghost" onClick={onBack}><ArrowLeft size={14} aria-hidden /> {backLabel}</button>}
      <span className="flex-1" />
      <button type={submit ? 'submit' : 'button'} className="btn" disabled={busy} onClick={submit ? undefined : onNext}>
        {nextLabel} <ArrowRight size={14} aria-hidden />
      </button>
    </div>
  );
}
