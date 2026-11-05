// Non-component helpers for the access UX (kept out of access.tsx so the
// component module stays fast-refresh friendly).

import type { useTranslation } from 'react-i18next';
import { ApiError } from '../../lib/api';

type TFunction = ReturnType<typeof useTranslation>['t'];

export const ROLE_ORDER = ['viewer', 'operator', 'admin', 'owner'] as const;
export type OrgRole = (typeof ROLE_ORDER)[number];

/** One-line plain-language summary of what a role can do. */
export function roleDesc(t: TFunction, role: string): string {
  return t(`access.roleDesc_${role}`, { defaultValue: '' });
}

/** Translate a failed admin mutation into a sentence with a next step.
 *  The backend's raw detail ("HTTP 403") never reaches the user alone. */
export function explainError(t: TFunction, e: unknown): string {
  if (e instanceof ApiError) {
    const body = e.body as { detail?: unknown; error?: unknown } | null;
    const detail = String(body?.detail ?? body?.error ?? e.message ?? '');
    if (e.status === 400 && /own role|yourself|themselves/i.test(detail)) return t('access.whyOwnRole');
    if (e.status === 403) return t('access.err403');
    if (e.status === 409 && /owner/i.test(detail)) return t('access.errLastOwner');
    if (e.status === 429) return t('access.errRate');
    return t('access.errGeneric', { status: e.status });
  }
  return t('access.errNetwork');
}
