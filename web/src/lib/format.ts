// Small formatting helpers. Values always render with tabular-nums (CSS).

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

export function fmtAge(ts: string | undefined, now = Date.now()): string {
  if (!ts) return '—';
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return '—';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export function fmtClock(ts: string | undefined): string {
  if (!ts) return '—';
  const t = new Date(ts);
  if (Number.isNaN(t.getTime())) return ts;
  return t.toLocaleTimeString('en-GB', { hour12: false });
}

export function fmtDuration(fromTs: string | undefined, now = Date.now()): string {
  if (!fromTs) return '—';
  const t = Date.parse(fromTs);
  if (Number.isNaN(t)) return '—';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function fmtUptime(seconds: number | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
