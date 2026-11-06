// Shelved-alarm list (who, why, until when). Own file so the notify api
// module stays untouched.

import { request } from '../../lib/api';

export interface ShelvedAlarm {
  id: string; rule: string; severity: string; state: string; tag: string;
  shelved_until: string; shelved_at: string | null; shelved_by: string | null; reason: string;
}

export const shelfApi = {
  list: (org: string) => request<{ items: ShelvedAlarm[] }>(`/api/v1/orgs/${org}/alarm-shelf`),
};

/** Reasons offered first; "Other" needs the free text. */
export const SHELVE_REASONS = ['maintenance', 'sensor', 'nuisance', 'commissioning', 'other'] as const;
export type ShelveReason = (typeof SHELVE_REASONS)[number];

/** Shelf lengths in minutes: a shelf is always time-limited, one week at most. */
export const SHELVE_MINUTES = [60, 240, 480, 1440, 10080] as const;
