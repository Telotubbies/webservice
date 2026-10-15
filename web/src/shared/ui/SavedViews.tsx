// Saved views (F12, Datadog Saved Views) — the URL query string IS the
// view. Save stores the current params under a name; apply restores them
// wholesale; delete removes. Page-scoped, ≤20 per page (oldest evicted),
// localStorage only — the panel says so, so nobody expects it on another PC.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useSavedViews } from '../../lib/savedViews';
import { Dropdown } from './Dropdown';
import { DdIcon } from './DdIcon';
import './explorerI18n';

/** Params that describe transient UI (an open drawer, a selected row) and
 *  should not be baked into a saved view. */
const TRANSIENT = ['fp', 'alarm', 'sel'];

function viewString(params: URLSearchParams, ignore: string[]): string {
  const p = new URLSearchParams(params);
  for (const k of ignore) p.delete(k);
  p.sort();
  return p.toString();
}

export function SavedViews({ page, ignore = TRANSIENT }: { page: string; ignore?: string[] }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const { views, save, remove } = useSavedViews(page);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const current = viewString(params, ignore);
  const active = views.find((v) => v.params === current);

  return (
    <Dropdown
      title={t('xp.viewsTitle')}
      className="saved-views"
      label={
        <>
          <DdIcon name="list" size={13} />
          <span className="max-w-[140px] truncate">{active ? active.name : t('xp.views')}</span>
          <DdIcon name="caret-down" size={12} />
        </>
      }
    >
      {(close) => (
        <div className="text-[13px]">
          <form
            className="border-b border-line p-3"
            onSubmit={(e) => {
              e.preventDefault();
              const n = name.trim();
              if (!n) return;
              save(n, current);
              setName('');
              setNote(t('views.saved'));
            }}
          >
            <label className="mb-1 block text-[12px] font-semibold text-ink" htmlFor={`sv-${page}`}>{t('xp.saveCurrent')}</label>
            <div className="flex gap-2">
              <input
                id={`sv-${page}`}
                className="input h-7 min-w-0 flex-1 text-[12px]"
                placeholder={t('xp.viewNamePh')}
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
                data-autofocus
              />
              <button type="submit" className="btn btn-sm" disabled={!name.trim()}>{t('xp.saveBtn')}</button>
            </div>
            <p className="mt-1 text-[11px] text-ink-46">{t('xp.overwrite')}</p>
          </form>
          <p className="px-3 pt-2 text-[11px] font-semibold text-ink-68">{t('views.saved')}</p>
          {views.length === 0 ? (
            <p className="px-3 pb-3 pt-1 text-[12px] text-ink-46">{t('views.none')}</p>
          ) : (
            <ul className="max-h-64 overflow-auto py-1" aria-label={t('views.saved')}>
              {views.map((v) => (
                <li key={v.name} className="group flex items-center gap-1 px-1">
                  <button
                    type="button"
                    className={`flex h-8 min-w-0 flex-1 items-center gap-2 rounded px-2 text-left hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none ${v === active ? 'font-semibold text-blue' : 'text-ink'}`}
                    aria-current={v === active ? 'true' : undefined}
                    onClick={() => {
                      // keep transient params (an open drawer) — replace the rest
                      const next = new URLSearchParams(v.params);
                      for (const k of ignore) { const cur = params.get(k); if (cur != null) next.set(k, cur); }
                      setParams(next);
                      setNote(t('xp.applied', { name: v.name }));
                      close();
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{v.name}</span>
                    {v === active && <span className="text-[11px] font-normal text-ink-46">{t('views.current')}</span>}
                  </button>
                  <button
                    type="button"
                    className="grid h-7 w-7 place-items-center rounded text-ink-46 hover:bg-subtle hover:text-[var(--color-danger)] focus-visible:bg-subtle focus-visible:outline-none"
                    aria-label={t('xp.deleteView', { name: v.name })}
                    title={t('views.delete')}
                    onClick={() => remove(v.name)}
                  >
                    <DdIcon name="cancel" size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-line px-3 py-2 text-[11px] text-ink-46">
            <span aria-live="polite">{note ? `${note} · ` : ''}</span>{t('xp.savedLocal')}
          </p>
        </div>
      )}
    </Dropdown>
  );
}
