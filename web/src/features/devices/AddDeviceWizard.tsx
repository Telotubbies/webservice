// Add device wizard: 1 connection type → 2 details → 3 install (provision
// call returns the one-time secret) → 4 wait for the first heartbeat.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Cable, CircleCheck, Cpu, Factory, LoaderCircle, Network, type LucideIcon } from 'lucide-react';
import { adminApi, ApiError, type Device } from '../../lib/api';
import { canAdmin } from '../../app/session';
import { useAdminOrg, useAdminSite } from '../admin/admin';
import { Notice } from '../../shared/ui/Feedback';
import { ProductHeader } from '../../shared/ui/Product';
import { CopyButton, SecretReveal } from './SecretReveal';
import { dockerRun, envFile, type Adapter } from './devices';

const TYPES: { id: Adapter | 'opcua' | 's7'; icon: LucideIcon; ready: boolean }[] = [
  { id: 'modbus', icon: Cable, ready: true },
  { id: 'sim', icon: Cpu, ready: true },
  { id: 'opcua', icon: Network, ready: false },
  { id: 's7', icon: Factory, ready: false },
];
const STEPS = ['type', 'details', 'install', 'verify'] as const;

export function AddDeviceWizard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { orgId, orgRole } = useAdminOrg();
  const { site, sites, setSiteId } = useAdminSite(orgId);
  const [step, setStep] = useState(0);
  const [adapter, setAdapter] = useState<Adapter>('modbus');
  const [name, setName] = useState('');
  const [host, setHost] = useState(() => location.hostname);
  const [pollMs, setPollMs] = useState(1000);
  const [tried, setTried] = useState(false);
  const [created, setCreated] = useState<{ edge: Device; secret: string } | null>(null);

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

  if (orgRole && !canAdmin(orgRole)) {
    return <div className="p-4"><Notice tone="warn">{t('dev.needAdmin')}</Notice></div>;
  }

  const nameErr = !name.trim() ? t('dev.errName') : name.trim().length > 80 ? t('dev.errNameLong') : '';
  const provisionErr = provision.error instanceof ApiError
    ? (String(provision.error.message).includes('plan_limit') ? t('dev.errPlan') : t('dev.actionFailed', { reason: provision.error.message }))
    : provision.error ? t('dev.actionFailed', { reason: String(provision.error) }) : '';
  const params = created && orgId && site ? {
    host, orgId, siteId: site.id, edgeId: created.edge.id, username: created.edge.mqtt_username,
    secret: created.secret, adapter, pollMs, siteCode: site.code || 'plant1',
  } : null;

  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader icon="server" title={t('dev.addTitle')} tabs={[{ to: '/infrastructure', label: t('dev.tabDevices'), end: true }]} />
      <div className="mx-auto w-full max-w-[880px] p-6">
        {/* stepper */}
        <ol className="mb-6 flex items-center gap-2" aria-label={t('dev.progress')}>
          {STEPS.map((s, i) => (
            <li key={s} className="flex flex-1 items-center gap-2" aria-current={i === step ? 'step' : undefined}>
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-semibold ${
                i < step ? 'bg-[#2c9a63] text-white' : i === step ? 'bg-blue text-white' : 'bg-line text-ink-68'}`}>
                {i < step ? '✓' : i + 1}
              </span>
              <span className={`text-[13px] ${i === step ? 'font-semibold text-ink' : 'text-ink-68'}`}>{t(`dev.step.${s}`)}</span>
              {i < STEPS.length - 1 && <span className="h-px flex-1 bg-line" aria-hidden />}
            </li>
          ))}
        </ol>

        <section className="rounded-[6px] border border-line bg-white p-5">
          {step === 0 && (
            <>
              <h2 className="text-[16px] font-semibold">{t('dev.typeTitle')}</h2>
              <p className="mt-1 text-[13px] text-ink-68">{t('dev.typeBody')}</p>
              <div className="mt-4 grid grid-cols-2 gap-3" role="radiogroup" aria-label={t('dev.typeTitle')}>
                {TYPES.map(({ id, icon: Ico, ready }) => (
                  <button key={id} type="button" role="radio" aria-checked={adapter === id} disabled={!ready}
                    onClick={() => ready && setAdapter(id as Adapter)}
                    className={`flex items-start gap-3 rounded border p-4 text-left focus-visible:outline-2 focus-visible:outline-blue disabled:cursor-not-allowed disabled:opacity-55 ${
                      adapter === id ? 'border-blue bg-info-soft' : 'border-line hover:border-ink-35'}`}>
                    <Ico size={22} className={adapter === id ? 'text-blue' : 'text-ink-68'} aria-hidden />
                    <span>
                      <span className="flex items-center gap-2 text-[14px] font-semibold">{t(`dev.type.${id}.name`)}
                        {!ready && <span className="rounded bg-subtle px-1.5 text-[10px] font-semibold uppercase text-ink-46">{t('dev.soon')}</span>}
                      </span>
                      <span className="mt-0.5 block text-[12px] text-ink-68">{t(`dev.type.${id}.body`)}</span>
                    </span>
                  </button>
                ))}
              </div>
              <Footer onNext={() => setStep(1)} nextLabel={t('dev.next')} />
            </>
          )}

          {step === 1 && (
            <form onSubmit={(e) => { e.preventDefault(); setTried(true); if (!nameErr && site) provision.mutate(); }}>
              <h2 className="text-[16px] font-semibold">{t('dev.detailsTitle')}</h2>
              <label className="mt-4 block text-[12px] font-semibold text-ink-68" htmlFor="dv-name">{t('dev.name')}</label>
              <input id="dv-name" className="input mt-1 w-full" value={name} maxLength={80} autoFocus
                placeholder={t('dev.namePh')} onChange={(e) => setName(e.target.value)} aria-invalid={tried && !!nameErr} aria-describedby="dv-name-help" />
              <p id="dv-name-help" className="mt-1 text-[11px] text-ink-46">{t('dev.nameHelp')}</p>
              {tried && nameErr && <p className="mt-1 text-[11px] text-[var(--color-danger)]" role="alert">{nameErr}</p>}

              <div className="mt-4 grid grid-cols-3 gap-3">
                <label className="text-[12px] font-semibold text-ink-68">{t('dev.site')}
                  <select className="input mt-1 w-full" value={site?.id ?? ''} onChange={(e) => setSiteId(e.target.value)}>
                    {sites.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
                  </select>
                </label>
                <label className="text-[12px] font-semibold text-ink-68">{t('dev.broker')}
                  <input className="input mt-1 w-full font-mono" value={host} onChange={(e) => setHost(e.target.value)} />
                </label>
                <label className="text-[12px] font-semibold text-ink-68">{t('dev.pollMs')}
                  <select className="input mt-1 w-full" value={pollMs} onChange={(e) => setPollMs(Number(e.target.value))}>
                    {[500, 1000, 2000, 5000].map((n) => <option key={n} value={n}>{n} ms</option>)}
                  </select>
                </label>
              </div>
              {provisionErr && <div className="mt-4"><Notice tone="error">{provisionErr}</Notice></div>}
              <Footer onBack={() => setStep(0)} backLabel={t('dev.back')} nextLabel={provision.isPending ? t('dev.creating') : t('dev.create')}
                submit busy={provision.isPending} />
            </form>
          )}

          {step === 2 && params && (
            <>
              <h2 className="text-[16px] font-semibold">{t('dev.installTitle')}</h2>
              <p className="mt-1 text-[13px] text-ink-68">{t('dev.installBody')}</p>
              <div className="mt-4"><SecretReveal username={params.username} secret={params.secret} /></div>
              <Snippet title={t('dev.envFile')} text={envFile(params)} copyLabel={t('dev.copyEnv')} />
              <Snippet title={t('dev.runCmd')} text={dockerRun(params)} copyLabel={t('dev.copyRun')} />
              <p className="mt-3 text-[12px] text-ink-68">{t('dev.certNote')}</p>
              {adapter === 'modbus' && <p className="mt-1 text-[12px] text-ink-68">{t('dev.modbusNote')}</p>}
              <Footer onNext={() => setStep(3)} nextLabel={t('dev.installedNext')} />
            </>
          )}

          {step === 3 && created && (
            <div className="py-6 text-center">
              {connected ? (
                <>
                  <CircleCheck size={40} className="mx-auto text-[#2c9a63]" aria-hidden />
                  <h2 className="mt-3 text-[16px] font-semibold" role="status">{t('dev.connected', { name: created.edge.name })}</h2>
                  <p className="mt-1 text-[13px] text-ink-68">{t('dev.connectedBody')}</p>
                  <div className="mt-5 flex justify-center gap-2">
                    <Link to="/infrastructure" className="btn btn-sm">{t('dev.toFleet')}</Link>
                    <Link to="/dashboards" className="btn btn-sm btn-ghost">{t('dev.toDashboards')}</Link>
                  </div>
                </>
              ) : (
                <>
                  <LoaderCircle size={40} className="mx-auto animate-spin text-blue motion-reduce:animate-none" aria-hidden />
                  <h2 className="mt-3 text-[16px] font-semibold" role="status">{t('dev.waiting')}</h2>
                  <p className="mt-1 text-[13px] text-ink-68">{t('dev.waitingBody')}</p>
                  <div className="mt-5 flex justify-center gap-2">
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setStep(2)}>{t('dev.showInstall')}</button>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => navigate('/infrastructure')}>{t('dev.finishLater')}</button>
                  </div>
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Snippet({ title, text, copyLabel }: { title: string; text: string; copyLabel: string }) {
  return (
    <div className="mt-4">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[12px] font-semibold text-ink-68">{title}</span>
        <CopyButton text={text} label={copyLabel} />
      </div>
      <pre className="overflow-x-auto rounded bg-[#1f2430] p-3 font-mono text-[12px] leading-5 text-[#e6e9ef]">{text}</pre>
    </div>
  );
}

function Footer({ onBack, onNext, backLabel, nextLabel, submit, busy }: {
  onBack?: () => void; onNext?: () => void; backLabel?: string; nextLabel: string; submit?: boolean; busy?: boolean;
}) {
  return (
    <div className="mt-6 flex items-center border-t border-line pt-4">
      {onBack && <button type="button" className="btn btn-sm btn-ghost" onClick={onBack}><ArrowLeft size={14} aria-hidden /> {backLabel}</button>}
      <span className="flex-1" />
      <button type={submit ? 'submit' : 'button'} className="btn btn-sm" disabled={busy} onClick={submit ? undefined : onNext}>
        {nextLabel} <ArrowRight size={14} aria-hidden />
      </button>
    </div>
  );
}
