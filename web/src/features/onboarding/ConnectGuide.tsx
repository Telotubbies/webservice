// "Connect your plant" guide on the Overview — teaches the three ways data
// gets into the console before anyone hunts through menus: the built-in
// simulator (what the demo shows), Factory I/O over Modbus TCP, and a real
// PLC (Modbus TCP / Siemens S7 / OPC UA) behind an enrolled edge gateway.
// Every step links to the page that does it. Hidden per browser once closed;
// the Overview header keeps a button to bring it back.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { onboardingApi } from '../../lib/api';
import { useAdminOrg } from '../admin/admin';
import { Card } from '../../shared/ui/Page';
import { Icon } from '../../shared/ui/Icon';
import { Segmented } from '../../shared/ui/Segmented';
import './guideI18n';

type Path = 'sim' | 'fio' | 'plc';
type Step = { key: string; to?: string; code?: string };

const ENROLL_CMD = `docker run -d --restart unless-stopped --name edge-bridge \\
  -e WDS_URL=https://<your-server> -e ENROLL_CODE=<code> \\
  -v edge-state:/var/lib/wds-edge edge-bridge`;

const STEPS: Record<Path, Step[]> = {
  sim: [
    { key: 's1', to: '/line' },
    { key: 's2', to: '/commands' },
    { key: 's3', to: '/admin/rules/new' },
  ],
  fio: [
    { key: 's1' },
    { key: 's2', to: '/infrastructure/add', code: ENROLL_CMD },
    { key: 's3', to: '/infrastructure/sources' },
    { key: 's4', to: '/commands' },
  ],
  plc: [
    { key: 's1' },
    { key: 's2', to: '/infrastructure/add', code: ENROLL_CMD },
    { key: 's3', to: '/infrastructure/sources' },
    { key: 's4', to: '/structure' },
  ],
};

function CopyCode({ code }: { code: string }) {
  const { t } = useTranslation();
  const [done, setDone] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(code).then(() => {
      setDone(true);
      window.setTimeout(() => setDone(false), 1500);
    }).catch(() => {});
  };
  return (
    <div className="mt-2 overflow-hidden rounded border border-line bg-subtle">
      <div className="flex items-center justify-between border-b border-line px-2 py-1">
        <span className="font-mono text-[11px] text-ink-46">shell</span>
        <button type="button" onClick={copy} className="btn btn-sm btn-ghost" aria-live="polite">
          {done ? t('guide.copied') : t('guide.copy')}
        </button>
      </div>
      <pre className="overflow-x-auto p-2 font-mono text-[12px] leading-relaxed text-ink">{code}</pre>
    </div>
  );
}

/** Where the first connection stands, read from real rows (gateway enrolled, data arriving). */
function ConnectStatus() {
  const { t } = useTranslation();
  const { orgId } = useAdminOrg();
  const q = useQuery({ queryKey: ['onboarding', orgId], queryFn: () => onboardingApi.get(orgId!), enabled: !!orgId, refetchInterval: 5_000 });
  if (!q.data) return null;
  const done = (k: string) => q.data.steps.some((s) => s.id === k && s.done);
  const state = done('data') ? 'live' : done('gateway') ? 'wait' : 'none';
  return (
    <p role="status" className="border-t border-line px-3 py-2 text-[13px] text-ink">
      <span className={`mr-2 inline-block h-2 w-2 rounded-full ${state === 'live' ? 'bg-[var(--color-ok)]' : state === 'wait' ? 'bg-[var(--color-warn)]' : 'bg-ink-46'}`} aria-hidden />
      {t(`guide.status_${state}`)}
    </p>
  );
}

export function ConnectGuide({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [path, setPath] = useState<Path>('fio');
  const steps = STEPS[path];

  return (
    <Card
      title={t('guide.title')}
      pad={false}
      actions={
        <button type="button" onClick={onClose} className="btn btn-sm btn-ghost" aria-label={t('guide.close')}>
          <Icon name="x" size={14} />
        </button>
      }
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2.5">
        <p className="min-w-0 flex-1 text-[13px] text-ink-46">{t('guide.lede')}</p>
        <Segmented<Path>
          label={t('guide.pathLabel')}
          value={path}
          onChange={setPath}
          options={[
            { value: 'sim', label: t('guide.sim.tab') },
            { value: 'fio', label: t('guide.fio.tab') },
            { value: 'plc', label: t('guide.plc.tab') },
          ]}
        />
      </div>

      <div className="px-3 pt-3">
        <p className="text-[13px] text-ink">{t(`guide.${path}.intro`)}</p>
      </div>

      <ol className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.key} className="flex min-w-0 flex-col rounded border border-line p-3">
            <div className="flex items-center gap-2">
              <span className="grid h-6 w-6 flex-none place-items-center rounded-full border border-line font-mono text-[12px] text-ink">
                {i + 1}
              </span>
              <h3 className="min-w-0 text-[13px] font-semibold text-ink">{t(`guide.${path}.${s.key}.t`)}</h3>
            </div>
            <p className="mt-2 flex-1 text-[12.5px] leading-relaxed text-ink-46">{t(`guide.${path}.${s.key}.d`)}</p>
            {s.code && <CopyCode code={s.code} />}
            {s.to && (
              <Link to={s.to} className="btn btn-sm btn-ghost mt-2 self-start">
                {t(`guide.${path}.${s.key}.go`)} <Icon name="arrow-right" size={13} />
              </Link>
            )}
          </li>
        ))}
      </ol>

      <ConnectStatus />
      <p className="flex items-start gap-2 border-t border-line px-3 py-2.5 text-[12px] text-ink-46">
        <Icon name="shield" size={14} />
        <span>{t(path === 'sim' ? 'guide.noteSim' : 'guide.noteSafety')}</span>
      </p>
    </Card>
  );
}
