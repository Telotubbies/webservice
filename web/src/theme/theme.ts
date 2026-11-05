// Theme preference — light / dark / system, stored per browser. The resolved
// theme lands on <html data-theme> (tokens.css keys the dark palette off it)
// and on color-scheme, so native controls and scrollbars follow. Storage may
// be unavailable (private window, blocked site data): every read/write is
// guarded and an unreadable choice means "system".

export type ThemePref = 'light' | 'dark' | 'system';
export type Theme = 'light' | 'dark';

const KEY = 'wds.theme';
const PREFS: readonly ThemePref[] = ['light', 'dark', 'system'];

export function resolveTheme(pref: ThemePref, prefersDark: boolean): Theme {
  return pref === 'system' ? (prefersDark ? 'dark' : 'light') : pref;
}

export function readThemePref(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): ThemePref {
  try {
    const v = storage?.getItem(KEY);
    return PREFS.includes(v as ThemePref) ? (v as ThemePref) : 'system';
  } catch {
    return 'system';
  }
}

export function writeThemePref(p: ThemePref, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try { storage?.setItem(KEY, p); } catch { /* session-only */ }
}

const osPrefersDark = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

/** Resolve and paint. `prefersDark` is injectable for tests; it defaults to
 *  the OS setting. */
export function applyTheme(pref: ThemePref, doc: Document = document, prefersDark = osPrefersDark()): Theme {
  const theme = resolveTheme(pref, prefersDark);
  doc.documentElement.dataset.theme = theme;
  doc.documentElement.style.colorScheme = theme;
  return theme;
}
