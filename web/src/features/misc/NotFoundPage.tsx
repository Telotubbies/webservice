// 404 — an unknown address keeps its path on screen instead of bouncing home,
// and offers the two ways out: the first page and the Ctrl+K palette search.

import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { DdIcon } from '../../shared/ui/DdIcon';
import { EmptyState } from '../../shared/ui/Feedback';
import { PageBar } from '../../shared/ui/Page';
import './i18n';

// the palette owns its open state, so ask it through the shortcut it listens for
const openPalette = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));

export function NotFoundPage() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  return (
    <div className="flex min-h-[calc(100svh-var(--h-topbar))] flex-col">
      <PageBar title={t('nf.title')} />
      <div className="p-4">
        <EmptyState
          icon="search"
          title={t('nf.heading')}
          body={t('nf.body', { path: pathname })}
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Link to="/" className="btn">{t('nf.home')}</Link>
              <button type="button" className="btn btn-ghost" onClick={openPalette}>
                <DdIcon name="search" size={14} aria-hidden /> {t('nf.search')}
                <kbd className="ml-1 rounded border border-line px-1 text-[10px] text-ink-46">Ctrl K</kbd>
              </button>
            </div>
          }
        />
        <p className="mt-3 text-center text-[12px] text-ink-46">
          {t('nf.path')}: <span className="font-mono text-ink-68">{pathname}</span>
        </p>
      </div>
    </div>
  );
}
