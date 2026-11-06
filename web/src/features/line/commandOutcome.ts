// Turns a command's status + edge detail into one honest outcome. Success is
// only `done`/`acknowledged`; mismatch, unknown, timeout and refusals are never
// rendered as success (F05).

import type { TFunction } from 'i18next';

export type Tone = 'ok' | 'bad' | 'warn' | 'wait';

export interface Outcome { tone: Tone; text: string }

const OK = new Set(['done', 'acknowledged']);
const DENIED = new Set(['denied', 'rejected']);
const WAITING = new Set(['issued', 'sent', 'acked', 'accepted', 'dispatched']);

/** `readback_mismatch:expected=32,actual=40` → {expected:'32', actual:'40'} */
function pairs(detail: string): Record<string, string> {
  const rest = detail.slice(detail.indexOf(':') + 1);
  return Object.fromEntries(rest.split(',').map((p) => p.split('=') as [string, string]));
}

export function outcomeOf(t: TFunction, status: string, detail?: string): Outcome {
  const d = detail ?? '';
  if (OK.has(status)) {
    // edge builds with read-back always say what they read; older ones just say done
    if (d.startsWith('readback_ok:')) return { tone: 'ok', text: t('f05.outOk', { v: d.slice(12) }) };
    return { tone: 'ok', text: t('lifecycle.done') };
  }
  if (WAITING.has(status)) return { tone: 'wait', text: t('f05.outWaiting') };
  if (status === 'unknown') return { tone: 'warn', text: t('f05.outUnknown', { why: d.replace(/^readback_unavailable:/, '') || '?' }) };
  if (status === 'timeout') return { tone: 'bad', text: t('f05.outTimeout') };
  if (d.startsWith('readback_mismatch:')) {
    const { expected = '?', actual = '?' } = pairs(d);
    return { tone: 'bad', text: t('f05.outMismatch', { expected, actual }) };
  }
  if (DENIED.has(status)) return { tone: 'bad', text: t('f05.outDenied', { why: d || '?' }) };
  return { tone: 'bad', text: t('f05.outFailed', { why: d || status }) };
}
