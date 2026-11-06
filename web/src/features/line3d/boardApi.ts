// Client of backend/app/plant/board.py. Board editing only stores layout and
// pictures; nothing here can reach the PLC.

import { request, ApiError } from '../../lib/api';
import { getScope } from '../../lib/scope';
import { v2 } from '../../lib/api';
import type { BoardLayout } from './boardLayout';
import type { PartCapture } from './boardCapture';

export interface BoardRow {
  id: string; version: number | null; status: 'draft' | 'published'; layout: BoardLayout;
  model_sha: string; created_by: string | null; created_at: string;
}
export interface BoardState {
  draft: BoardRow | null; published: BoardRow | null;
  versions: { version: number; created_at: string; created_by: string | null }[];
}

/** Where a part's controls live: the twin page with the part selected (its panel opens F05's control sheet). */
export const controlHref = (p: { label: string }) => `/?part=${encodeURIComponent(p.label)}`;

/** sha used for the bundled demo plant, which has no uploaded model row */
export const DEMO_SHA = 'demo-centrale-beton';

/** capture-cache key: the sha alone would reuse another tenant's pictures after an org switch */
export const capKey = (sha: string) => { const s = getScope(); return `${s?.orgId}/${s?.siteId}/${sha}`; };

const base = (path: string) => {
  const s = getScope();
  if (!s) throw new ApiError(0, null, 'no active scope');
  return v2(s.orgId, `/sites/${s.siteId}/plant-board${path}`);
};
const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) });

export const boardApi = {
  get: (sha: string) => request<BoardState>(base(`?model_sha=${encodeURIComponent(sha)}`)),
  saveDraft: (sha: string, modelId: string | null, layout: BoardLayout) =>
    request<{ draft: BoardRow }>(base('/draft'), json('PUT', { model_sha: sha, model_id: modelId, layout })).then((r) => r.draft),
  publish: (sha: string) =>
    request<{ published: BoardRow }>(base('/publish'), json('POST', { model_sha: sha })).then((r) => r.published),
  rollback: (sha: string, version: number) =>
    request<{ published: BoardRow }>(base('/rollback'), json('POST', { model_sha: sha, version })).then((r) => r.published),
  captures: (sha: string) =>
    request<{ items: PartCapture[] }>(base(`/captures?model_sha=${encodeURIComponent(sha)}`)).then((r) => r.items),
  saveCaptures: (sha: string, caps: PartCapture[]) => {
    const items = caps.map((c) => ({ key: c.key, w: c.w, h: c.h, view: c.view, box: c.box, png_b64: c.url.split(',')[1] }));
    // the server takes at most 120 pictures per request
    const chunks: typeof items[] = [];
    for (let i = 0; i < items.length; i += 60) chunks.push(items.slice(i, i + 60));
    return Promise.all(chunks.map((part) => request<{ saved: number }>(base('/captures'), json('PUT', { model_sha: sha, items: part }))));
  },
};
