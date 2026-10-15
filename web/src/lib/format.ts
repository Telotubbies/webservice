// Small formatting helpers. Values always render with tabular-nums (CSS).

import i18n from './i18n';

export function shortTag(name: string): string {
  const parts = name.split('.');
  return parts.slice(-2).join('.');
}

export function leafTag(name: string): string {
  const parts = name.split('.');
  return parts[parts.length - 1] ?? name;
}

export function fmtValue(v: number | boolean | undefined): string {
  if (v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'RUN' : 'STOP';
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

/** Locale-aware "x ago" — narrow units keep cells compact
 *  ("5 min. ago" / "5 นาทีที่แล้ว"). Cached per language. */
let rtfCache: { lang: string; fmt: Intl.RelativeTimeFormat } | null = null;
function agoFmt(): Intl.RelativeTimeFormat {
  if (rtfCache?.lang !== i18n.language) {
    rtfCache = { lang: i18n.language, fmt: new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto', style: 'narrow' }) };
  }
  return rtfCache.fmt;
}

export function fmtAge(ts: string | undefined, now = Date.now()): string {
  if (!ts) return '—';
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return '—';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return agoFmt().format(-s, 'second');
  const m = Math.floor(s / 60);
  if (m < 60) return agoFmt().format(-m, 'minute');
  return agoFmt().format(-Math.floor(m / 60), 'hour');
}

export function fmtClock(ts: string | undefined): string {
  if (!ts) return '—';
  const t = new Date(ts);
  if (Number.isNaN(t.getTime())) return ts;
  return t.toLocaleTimeString(i18n.language, { hour12: false });
}

/** Compact duration units — s/m/h in English, Thai abbreviations in Thai. */
function durUnits(): { s: string; m: string; h: string } {
  return i18n.language.startsWith('th')
    ? { s: ' วิ', m: ' นาที', h: ' ชม.' }
    : { s: 's', m: 'm', h: 'h' };
}

export function fmtDuration(fromTs: string | undefined, now = Date.now()): string {
  if (!fromTs) return '—';
  const t = Date.parse(fromTs);
  if (Number.isNaN(t)) return '—';
  const s = Math.max(0, Math.round((now - t) / 1000));
  const u = durUnits();
  if (s < 60) return `${s}${u.s}`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}${u.m} ${s % 60}${u.s}`;
  return `${Math.floor(m / 60)}${u.h} ${m % 60}${u.m}`;
}

export function fmtUptime(seconds: number | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const s = Math.floor(seconds);
  const u = durUnits();
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}${u.h} ${m}${u.m}`;
  if (m > 0) return `${m}${u.m} ${s % 60}${u.s}`;
  return `${s}${u.s}`;
}
