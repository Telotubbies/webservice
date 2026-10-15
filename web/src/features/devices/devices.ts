// Device status derivation + install snippet. Status windows are UI policy:
// the edge heartbeats every POLL_MS (default 1s), so 30s silence is stale and
// 5 min is offline.

import type { Device } from '../../lib/api';

export type DeviceState = 'online' | 'stale' | 'offline' | 'never' | 'disabled';

export function deviceState(d: Device, now: number): DeviceState {
  if (d.status === 'disabled') return 'disabled';
  if (!d.last_hb_at) return 'never';
  const age = now - Date.parse(d.last_hb_at);
  if (age <= 30_000) return 'online';
  if (age <= 300_000) return 'stale';
  return 'offline';
}

export const STATE_STYLE: Record<DeviceState, { dot: string; pill: string; glyph: string }> = {
  online: { dot: 'bg-[#2c9a63]', pill: 'bg-[#e6f5ec] text-[#1c6b45]', glyph: '●' },
  stale: { dot: 'bg-[#f99d02]', pill: 'bg-[#fff4dc] text-[#8a5a00]', glyph: '◆' },
  offline: { dot: 'bg-[#d24f57]', pill: 'bg-[#fde8ea] text-[#a3263c]', glyph: '▲' },
  never: { dot: 'bg-[#828ba4]', pill: 'bg-subtle text-ink-68', glyph: '○' },
  disabled: { dot: 'bg-[#c8cdd5]', pill: 'bg-subtle text-ink-46', glyph: '■' },
};

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
    `docker run -d --name edge-${p.edgeId.slice(0, 8)} --restart unless-stopped \\`,
    '  --env-file edge.env \\',
    '  -v "$PWD/certs:/certs:ro" \\',
    '  edge-bridge',
  ].join('\n');
}
