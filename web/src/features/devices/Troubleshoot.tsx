// Connection checklist for a device that hasn't reported: the five things
// that go wrong in practice, most likely first, each checkable on site.

import { useTranslation } from 'react-i18next';
import { CopyButton } from './SecretReveal';
import { containerName } from './devices';

export function Troubleshoot({ host, edgeId, className = 'mx-auto mt-4 max-w-[560px]' }: { host: string; edgeId: string; className?: string }) {
  const { t } = useTranslation();
  const logs = `docker logs --tail 50 ${containerName(edgeId)}`;
  return (
    <div className={`${className} rounded border border-line bg-subtle p-3 text-left text-[12.5px]`}>
      <h3 className="font-semibold">{t('dev.slowTitle')}</h3>
      <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-ink-68">
        <li>{t('dev.slow.running')}
          <span className="mt-1 flex items-center gap-2">
            <code className="min-w-0 flex-1 select-all break-all rounded bg-white px-2 py-1 font-mono text-[12px] text-ink">{logs}</code>
            <CopyButton text={logs} label={t('dev.copyRun')} />
          </span>
        </li>
        <li>{t('dev.slow.port', { host })}</li>
        <li>{t('dev.slow.cert')}</li>
        <li>{t('dev.slow.clock')}</li>
        <li>{t('dev.slow.key')}</li>
      </ol>
    </div>
  );
}
