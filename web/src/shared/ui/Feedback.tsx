import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, type IconName } from './Icon';

// Feedback primitives — every page needs the same five non-happy states
// (design 04 §7): loading → Skeleton/PageSkeleton/SkeletonRows · empty →
// EmptyState · error → ErrorState · stale → StaleNotice (+ Freshness in
// Status.tsx) · demo → DemoNotice/DemoBadge · no permission → PermissionNotice.
// See ./README.md for when to use which.

/** Nothing to show. Say what the list holds and what to do next (action). */
export function EmptyState({ title, body, icon = 'check', action, compact }: {
  title: string; body?: string; icon?: IconName; action?: ReactNode;
  /** tighter padding for use inside a card/widget */
  compact?: boolean;
}) {
  return (
    <div className={`empty${compact ? ' is-compact' : ''}`} role="status">
      <Icon name={icon} size={compact ? 22 : 28} />
      <h3>{title}</h3>
      {body && <p>{body}</p>}
      {action}
    </div>
  );
}

/** A fetch failed. Default copy = backend unreachable; pass title/detail
 *  for anything more specific. Always offer onRetry when retry can work. */
export function ErrorState({ onRetry, detail, title, compact }: {
  onRetry?: () => void; detail?: string; title?: string; compact?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className={`error-state${compact ? ' is-compact' : ''}`} role="alert">
      <Icon name="warn" size={compact ? 22 : 28} />
      <h3>{title ?? t('errors.load')}</h3>
      <p>{detail ?? t('errors.loadBody')}</p>
      {onRetry && (
        <button type="button" className="btn btn-sm" onClick={onRetry}>
          <Icon name="refresh" size={16} /> {t('common.retry')}
        </button>
      )}
    </div>
  );
}

export type NoticeTone = 'info' | 'warn' | 'error' | 'ok' | 'demo' | 'neutral';

/** Inline banner inside a page. info = blue note · warn/error = abnormal
 *  (amber/red, with icon) · ok = success confirmation · demo = simulated
 *  data (dashed blue) · neutral = grey aside. */
export function Notice({ tone = 'info', children, icon, action }: {
  tone?: NoticeTone; children: ReactNode; icon?: IconName;
  /** optional trailing control, e.g. a retry or "learn more" button */
  action?: ReactNode;
}) {
  // error → assertive alert, warn → polite live region, others → passive note
  const role = tone === 'error' ? 'alert' : tone === 'warn' ? 'status' : 'note';
  const fallback: IconName = tone === 'warn' || tone === 'error' ? 'warn'
    : tone === 'ok' ? 'check-circle' : 'info';
  return (
    <div className={`notice${tone !== 'info' ? ` notice-${tone}` : ''}`} role={role}>
      <Icon name={icon ?? fallback} size={18} />
      <div>{children}</div>
      {action && <div style={{ flex: 'none' }}>{action}</div>}
    </div>
  );
}

/** Page-level "this is simulated" banner (design §7 demo-data state). */
export function DemoNotice({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  return <Notice tone="demo">{children ?? t('ui.demoNotice')}</Notice>;
}

/** Inline label next to a single simulated value / widget title. */
export function DemoBadge({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <span className="demo-badge" title={t('ui.demoTitle')} data-demo>
      <span aria-hidden>◌</span>{label ?? t('ui.demo')}
    </span>
  );
}

/** The live feed is down / this panel's data is old. Pass `age` (already
 *  formatted, e.g. fmtAge(ts)) when you know when the last value arrived. */
export function StaleNotice({ age, children }: { age?: string; children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <Notice tone="warn" icon="clock">
      {children ?? (age ? t('ui.staleFor', { age }) : t('ui.linkReconnecting'))}
    </Notice>
  );
}

/** Role gate explanation: hide the action, show this instead (design §7
 *  no-permission state). `role` is the role key, e.g. 'admin'. */
export function PermissionNotice({ role = 'admin', children }: { role?: string; children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <Notice tone="neutral" icon="lock">
      {children ?? t('ui.needRole', { role: t(`roles.${role}`, { defaultValue: role }) })}
    </Notice>
  );
}

export function Skeleton({ w = '100%', h = 16 }: { w?: number | string; h?: number }) {
  return <span className="skeleton" style={{ width: w, height: h }} aria-hidden />;
}

/** Stack of row placeholders for a table/list/card body. */
export function SkeletonRows({ rows = 4, h = 28 }: { rows?: number; h?: number }) {
  const { t } = useTranslation();
  return (
    <div className="skeleton-stack" role="status" aria-label={t('common.loading')}>
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} h={h} />)}
    </div>
  );
}

/** Shaped first-load placeholder for whole pages (v4 T12): heading line +
 *  panel of row blocks, rendered under the page's own PageBar — matches the
 *  page's structure, never a spinner. */
export function PageSkeleton({ rows = 4 }: { rows?: number }) {
  const { t } = useTranslation();
  return (
    <div className="page page-body" role="status" aria-busy="true" aria-label={t('common.loading')}>
      <div className="context-bar"><Skeleton w={200} h={20} /></div>
      <section className="panel skeleton-panel">
        {Array.from({ length: rows }, (_, i) => <Skeleton key={i} h={28} />)}
      </section>
    </div>
  );
}
