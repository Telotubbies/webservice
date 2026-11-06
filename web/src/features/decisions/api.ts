import { request, v2 } from '../../lib/api';
import type { OptionKey } from './compare';

export interface Decision {
  id: string; subject: string; option_key: OptionKey; reason: string;
  snapshot: Record<string, unknown>; decided_by: string | null; decided_at: string;
}
export interface DecisionIn { subject: string; option_key: OptionKey; reason: string; snapshot: Record<string, unknown> }

const base = (org: string, site: string) => v2(org, `/sites/${site}/decisions`);

export const decisionsApi = {
  list: (org: string, site: string, subject: string) =>
    request<{ items: Decision[] }>(`${base(org, site)}?subject=${encodeURIComponent(subject)}&limit=10`),
  record: (org: string, site: string, body: DecisionIn) =>
    request<{ decision: Decision }>(base(org, site), { method: 'POST', body: JSON.stringify(body) }),
};
