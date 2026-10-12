import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, type IconName } from './Icon';

export function EmptyState({ title, body, icon = 'check', action }: {
  title: string; body?: string; icon?: IconName; action?: ReactNode;
}) {
  return (
    <div className="empty" role="status">
      <Icon name={icon} size={28} />
      <h3>{title}</h3>
      {body && <p>{body}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ onRetry, detail }: { onRetry?: () => void; detail?: string }) {
  const { t } = useTranslation();
  return (
    <div className="error-state" role="alert">
      <Icon name="warn" size={28} />
      <h3>{t('errors.load')}</h3>
      <p>{detail ?? t('errors.loadBody')}</p>
      {onRetry && (
        <button className="btn btn-sm" onClick={onRetry}>
          <Icon name="refresh" size={16} /> {t('common.retry')}
        </button>
      )}
    </div>
  );
}

export function Notice({ tone = 'info', children, icon }: {
  tone?: 'info' | 'warn' | 'error'; children: ReactNode; icon?: IconName;
}) {
  return (
    <div className={`notice${tone !== 'info' ? ` notice-${tone}` : ''}`} role={tone === 'error' ? 'alert' : 'note'}>
      <Icon name={icon ?? (tone === 'info' ? 'info' : 'warn')} size={18} />
      <div>{children}</div>
    </div>
  );
}

export function Skeleton({ w = '100%', h = 16 }: { w?: number | string; h?: number }) {
  return <span className="skeleton" style={{ width: w, height: h }} aria-hidden />;
}

/** Shaped first-load placeholder for whole pages (v4 T12): context bar +
 *  panel + row blocks — matches the page's structure, never a spinner. */
export function PageSkeleton({ rows = 4 }: { rows?: number }) {
  const { t } = useTranslation();
  return (
    <div className="page" role="status" aria-label={t('common.loading')}>
      <div className="context-bar"><Skeleton w={200} h={20} /></div>
      <section className="panel">
        <div className="panel-body" style={{ display: 'grid', gap: 12 }}>
          {Array.from({ length: rows }, (_, i) => <Skeleton key={i} h={28} />)}
        </div>
      </section>
    </div>
  );
}
