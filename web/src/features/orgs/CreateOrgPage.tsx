// "Create organization" — shown to a signed-in user with no org yet, and
// reachable from the org switcher. Slug is derived from the name until the
// user edits it. Reuses the sign-in wall surface (auth.css / landing.css).

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { ApiError, orgApi } from '../../lib/api';
import { setLang } from '../../lib/i18n';
import { refreshSession, signOut } from '../../app/session';
import { Icon } from '../../shared/ui/Icon';
import '../landing/landing.css';
import '../auth/auth.css';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugify(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

const ZONES = ['Asia/Bangkok', 'Asia/Singapore', 'Asia/Tokyo', 'Europe/London', 'America/New_York', 'UTC'];

type Err = 'taken' | 'format' | 'reserved' | 'email' | 'generic' | null;

export function CreateOrgPage({ standalone = true }: { standalone?: boolean }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [edited, setEdited] = useState(false);
  const [tz, setTz] = useState('Asia/Bangkok');
  const [lang, setLangSel] = useState<'en' | 'th'>(i18n.language === 'th' ? 'th' : 'en');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Err>(null);

  const effSlug = edited ? slug : slugify(name);
  const slugOk = SLUG_RE.test(effSlug) && effSlug.length >= 3;

  const submit = async () => {
    if (busy || !name.trim() || !slugOk) return;
    setBusy(true);
    setErr(null);
    try {
      await orgApi.create({ name: name.trim(), slug: effSlug, timezone: tz, language: lang });
      await refreshSession(); // picks up the new membership and selects it
      navigate('/', { replace: true });
    } catch (e) {
      const body = e instanceof ApiError ? String((e.body as { detail?: unknown })?.detail ?? '') : '';
      if (body.includes('slug_taken')) setErr('taken');
      else if (body.includes('email_not_verified')) setErr('email');
      else if (body.includes('slug_reserved')) setErr('reserved');
      else if (body.includes('slug_format')) setErr('format');
      else setErr('generic');
    } finally {
      setBusy(false);
    }
  };

  const form = (
    <form className="dev-signin" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
      <label className="dev-signin-label" htmlFor="org-name">{t('org.name')}</label>
      <input id="org-name" className="dev-input" value={name} autoFocus maxLength={120}
        onChange={(e) => { setName(e.target.value); setErr(null); }} placeholder="Acme Plant" />

      <label className="dev-signin-label" htmlFor="org-slug">{t('org.slug')}</label>
      <input id="org-slug" className="dev-input" value={effSlug} maxLength={40} spellCheck={false}
        aria-invalid={effSlug !== '' && !slugOk} aria-describedby="org-slug-hint"
        onChange={(e) => { setSlug(e.target.value.toLowerCase()); setEdited(true); setErr(null); }} />
      <span className="hint" id="org-slug-hint">{t('org.slugHint')}</span>

      <label className="dev-signin-label" htmlFor="org-tz">{t('org.timezone')}</label>
      <select id="org-tz" className="dev-input" value={tz} onChange={(e) => setTz(e.target.value)}>
        {ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
      </select>

      <label className="dev-signin-label" htmlFor="org-lang">{t('org.language')}</label>
      <select id="org-lang" className="dev-input" value={lang}
        onChange={(e) => setLangSel(e.target.value === 'th' ? 'th' : 'en')}>
        <option value="en">English</option>
        <option value="th">ไทย</option>
      </select>

      <button type="submit" className="signin-choice signin-primary" disabled={busy || !name.trim() || !slugOk}>
        {busy ? t('org.creating') : t('org.submit')}
      </button>
      {err && (
        <p className="signin-denied" role="alert">
          <Icon name="warn" size={14} />
          <span>{t(`org.err.${err}`)}</span>
        </p>
      )}
    </form>
  );

  if (!standalone) return form;
  return (
    <div className="signin-wall signin-noir">
      <div className="hx-noise" aria-hidden />
      <div className="signin-stripes" aria-hidden />
      <div className="signin-frame" aria-hidden />
      <span className="signin-lang" role="group" aria-label={t('shell.language')}>
        <button type="button" lang="en" aria-pressed={i18n.language === 'en'} onClick={() => setLang('en')}>EN</button>
        <button type="button" lang="th" aria-pressed={i18n.language === 'th'} onClick={() => setLang('th')}>TH</button>
      </span>
      <h1 className="signin-title">{t('org.title')}</h1>
      <main className="signin-card">
        <span className="hx-corners" aria-hidden><i /><i /><i /><i /></span>
        <p className="hint">{t('org.intro')}</p>
        {form}
        <div className="signin-actions">
          <button type="button" className="signin-choice" onClick={signOut}>
            <Icon name="logout" size={15} />
            {t('auth.signOut')}
          </button>
        </div>
      </main>
    </div>
  );
}
