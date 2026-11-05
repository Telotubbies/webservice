// Acknowledge helpers shared by the alarm list and detail page.
// The ack endpoint returns the updated alarm (acked_by display name), so the
// row shows WHO acknowledged straight away instead of a bare "Acknowledged".
// When the response has no acked_at (v1 shape), we stamp the client time of
// the successful response — it is the ack moment to within a round trip.

import { api, ApiError } from '../../lib/api';
import { live } from '../../lib/live';
import type { Alarm } from '../../types';

function isAlarm(x: unknown): x is Alarm {
  return !!x && typeof x === 'object' && 'id' in x && 'state' in x;
}

export async function ackAlarm(alarm: Alarm): Promise<void> {
  const res = await api.ackAlarm(alarm.id);
  const next: Alarm = isAlarm(res) ? { ...alarm, ...res } : { ...alarm, state: 'acked' };
  if (next.state === 'acked' && !next.acked_at) next.acked_at = new Date().toISOString();
  live.upsertAlarm(next);
}

/** Ack many; never stops at the first failure. */
export async function ackMany(alarms: Alarm[]): Promise<{ ok: number; failed: number; error: unknown }> {
  const res = await Promise.allSettled(alarms.map((a) => ackAlarm(a)));
  const bad = res.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  return { ok: res.length - bad.length, failed: bad.length, error: bad[0]?.reason };
}

/** Short operator-readable reason; never a raw stack or JSON blob. */
export function errText(e: unknown, t: (k: string) => string): string {
  if (e instanceof ApiError) {
    if (e.status === 401 || e.status === 403) return t('alx.errRole');
    if (e.status === 404) return t('alx.errGone');
    if (e.status === 429) return t('alx.errRate');
    if (e.status >= 500) return t('alx.errServer');
  }
  if (e instanceof TypeError) return t('alx.errNetwork'); // fetch network failure
  return e instanceof Error ? e.message : String(e);
}
