// Device status derivation + install snippet. Status windows are UI policy:
// the edge heartbeats every POLL_MS (default 1s), so 30s silence is stale and
// 5 min is offline.

import type { TFunction } from 'i18next';
import { ApiError, type Device } from '../../lib/api';

export type DeviceState = 'online' | 'stale' | 'offline' | 'never' | 'disabled';

export function deviceState(d: Device, now: number): DeviceState {
  if (d.status === 'disabled') return 'disabled';
  if (!d.last_hb_at) return 'never';
  const age = now - Date.parse(d.last_hb_at);
  if (age <= 30_000) return 'online';
  if (age <= 300_000) return 'stale';
  return 'offline';
}

// Token-only colours (no raw hex in TSX — 04-ux-ui §5). The ok/caution tokens
// are too light for 11px text on their soft tints (~3.3:1), so pill text is
// the token darkened 30% (≥ 5.5:1, WCAG AA). Red/amber appear ONLY for the
// abnormal states (ISA-101); every state also carries a glyph + label.
const OK_TEXT = 'text-[color-mix(in_srgb,var(--color-ok)_70%,black)]';
const CAUTION_TEXT = 'text-[color-mix(in_srgb,var(--color-caution)_70%,black)]';
export const STATE_STYLE: Record<DeviceState, { pill: string; tile: string; glyph: string }> = {
  online: { pill: `bg-[var(--color-ok-soft)] ${OK_TEXT}`, tile: `border-[var(--color-ok)] bg-[var(--color-ok-soft)] ${OK_TEXT}`, glyph: '●' },
  stale: { pill: `bg-[var(--color-caution-soft)] ${CAUTION_TEXT}`, tile: `border-[var(--color-caution)] bg-[var(--color-caution-soft)] ${CAUTION_TEXT}`, glyph: '◆' },
  offline: { pill: 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]', tile: 'border-[var(--color-danger)] bg-[var(--color-danger-soft)] text-[var(--color-danger)]', glyph: '▲' },
  never: { pill: 'border border-line bg-white text-ink-68', tile: 'border-line bg-white text-ink-68', glyph: '○' },
  disabled: { pill: 'bg-subtle text-ink-46 line-through decoration-ink-35', tile: 'border-line bg-subtle text-ink-46', glyph: '■' },
};
export const CAUTION_TEXT_CLASS = CAUTION_TEXT;
export const OK_TEXT_CLASS = OK_TEXT;

/** Abnormal = needs a technician. Only these get a coloured tile/pill. */
export const isAbnormal = (s: DeviceState) => s === 'stale' || s === 'offline';

/** Omnibar: `status:offline adapter:modbus` tokens AND together; anything
 *  else is free text over name / id / MQTT user (never silently dropped). */
export function matchDevice(d: Device & { state: DeviceState; adapterKey: string }, q: string): boolean {
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((tok) => {
    const m = tok.match(/^(status|state|adapter|connection|conn):(.+)$/);
    if (m) return (m[1] === 'status' || m[1] === 'state' ? d.state : d.adapterKey).includes(m[2]);
    return `${d.name} ${d.id} ${d.mqtt_username}`.toLowerCase().includes(tok);
  });
}

/** Clipboard with a fallback for plain-HTTP origins (a plant-floor laptop on
 *  http://<lan-ip> has no navigator.clipboard). Resolves false on failure so
 *  the UI can tell the technician to copy by hand — never a silent no-op. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the legacy path */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Save text as a file (edge.env) — easier than pasting into nano on a gateway. */
export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text.endsWith('\n') ? text : `${text}\n`], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** API failure → a sentence a technician can act on (never a bare "HTTP 503"). */
export function actionError(e: unknown, t: TFunction): string {
  if (e instanceof ApiError) {
    if (e.message.includes('plan_limit')) return t('dev.errPlan');
    if (e.status === 403) return t('dev.needAdmin');
    if (e.status === 409) return t('dev.errNotActive');
    if (e.status === 429) return t('errors.rateLimited');
    if (e.status === 503) return t('dev.errBroker');
    return t('dev.actionFailed', { reason: e.message });
  }
  return t('dev.errNetwork');
}

/** Container name used by dockerRun — reused for the `docker logs` hint. */
export const containerName = (edgeId: string) => `edge-${edgeId.slice(0, 8)}`;

export type Adapter = 'sim' | 'modbus';

export interface InstallParams {
  host: string; orgId: string; siteId: string; edgeId: string;
  username: string; secret: string; adapter: Adapter; pollMs: number; siteCode: string;
}

/** Env file for edge-bridge (keys from edge-bridge/README §Configuration). */
export function envFile(p: InstallParams): string {
  return [
    `MQTT_HOST=${p.host}`, 'MQTT_PORT=8883', 'MQTT_CA_FILE=/certs/ca.crt',
    `MQTT_USER=${p.username}`, `MQTT_PASSWORD=${p.secret}`,
    `ORG_ID=${p.orgId}`, `SITE_ID=${p.siteId}`, `EDGE_ID=${p.edgeId}`,
    `SITE=${p.siteCode}`, `ADAPTER=${p.adapter}`, `POLL_MS=${p.pollMs}`,
  ].join('\n');
}

export function dockerRun(p: InstallParams): string {
  return [
    `docker run -d --name ${containerName(p.edgeId)} --restart unless-stopped \\`,
    '  --env-file edge.env \\',
    '  -v "$PWD/certs:/certs:ro" \\',
    '  edge-bridge',
  ].join('\n');
}
