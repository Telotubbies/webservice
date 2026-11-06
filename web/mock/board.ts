// Mock of backend/app/plant/board.py: the plant board's draft / publish /
// rollback and part captures, kept in memory per model sha. The version rules
// are the real ones (publish consumes the draft and takes the next number;
// rollback copies an old version forward and keeps the draft), so the console
// behaves like it will against the backend.

type Layout = Record<string, unknown> & { items: Record<string, unknown> };
interface Row { id: string; version: number | null; status: 'draft' | 'published'; layout: Layout; model_sha: string; created_by: string; created_at: string }
interface Capture { key: string; w: number; h: number; view: string; url: string; box: unknown }

const boards = new Map<string, Row[]>();
const captures = new Map<string, Map<string, Capture>>();
let seq = 0;
const SHA = /^[A-Za-z0-9_-]{4,64}$/;
const PNG_B64 = 'iVBORw0KGgo';   // base64 of the PNG magic

export interface BoardCtx { config: boolean; who: string; now: string }
type Out = { code: number; data: unknown };
const out = (code: number, data: unknown): Out => ({ code, data });

const pub = (rows: Row[]) => rows.filter((r) => r.status === 'published').sort((a, b) => b.version! - a.version!);
const dto = (r: Row | undefined) => (r ? { ...r } : null);

function validLayout(l: unknown): l is Layout {
  const x = l as Layout | null;
  return !!x && x.v === 1 && typeof x.items === 'object' && x.items !== null && Object.keys(x.items).length <= 400
    && Object.keys(x.items).every((k) => /^[A-Za-z0-9_.-]{1,40}$/.test(k))
    && Object.values(x.items).every((i) => ['x', 'y', 'w', 'h'].every((f) => Number.isFinite((i as Record<string, number>)[f])));
}

/** `rest` is the path after /sites/:id; returns undefined when it is not a board route. */
export function boardRoute(rest: string, method: string, q: (k: string) => string | undefined, b: Record<string, unknown>, c: BoardCtx): Out | undefined {
  const m = /^\/plant-board(\/draft|\/publish|\/rollback|\/captures)?$/.exec(rest);
  if (!m) return undefined;
  const sub = m[1] ?? '';
  const write = method !== 'GET';
  if (write && !c.config) return out(403, { detail: 'admin role required' });
  const sha = String((write ? b.model_sha : q('model_sha')) ?? '');
  if (!SHA.test(sha)) return out(422, { detail: 'bad model_sha' });
  const rows = boards.get(sha) ?? [];

  if (sub === '' && method === 'GET') {
    const p = pub(rows);
    return out(200, {
      draft: dto(rows.find((r) => r.status === 'draft')), published: dto(p[0]),
      versions: p.map((r) => ({ version: r.version, created_at: r.created_at, created_by: r.created_by })),
    });
  }
  if (sub === '/draft' && method === 'PUT') {
    if (!validLayout(b.layout)) return out(422, { detail: 'invalid layout' });
    const old = rows.find((r) => r.status === 'draft');
    const row: Row = { id: old?.id ?? `pb-${++seq}`, version: null, status: 'draft', layout: b.layout, model_sha: sha, created_by: c.who, created_at: c.now };
    boards.set(sha, [...rows.filter((r) => r !== old), row]);
    return out(200, { draft: row });
  }
  if (sub === '/publish' && method === 'POST') {
    const d = rows.find((r) => r.status === 'draft');
    if (!d) return out(409, { detail: 'no draft to publish' });
    const next = (pub(rows)[0]?.version ?? 0) + 1;
    const row: Row = { ...d, status: 'published', version: next, created_by: c.who, created_at: c.now };
    boards.set(sha, rows.map((r) => (r === d ? row : r)));
    return out(200, { published: row });
  }
  if (sub === '/rollback' && method === 'POST') {
    const old = pub(rows).find((r) => r.version === b.version);
    if (!old) return out(404, { detail: 'version not found' });
    const row: Row = { ...old, id: `pb-${++seq}`, version: pub(rows)[0].version! + 1, created_by: c.who, created_at: c.now };
    boards.set(sha, [...rows, row]);
    return out(200, { published: row });
  }
  if (sub === '/captures' && method === 'GET') return out(200, { items: [...(captures.get(sha)?.values() ?? [])] });
  if (sub === '/captures' && method === 'PUT') {
    const items = Array.isArray(b.items) ? (b.items as Record<string, unknown>[]) : [];
    if (items.length === 0 || items.length > 120) return out(422, { detail: 'items: 1..120' });
    const store = captures.get(sha) ?? new Map<string, Capture>();
    for (const it of items) {
      if (!/^[A-Za-z0-9_.-]{1,40}$/.test(String(it.key)) || !String(it.png_b64 ?? '').startsWith(PNG_B64)) return out(422, { detail: `${it.key}: image must be a PNG` });
      store.set(String(it.key), { key: String(it.key), w: Number(it.w), h: Number(it.h), view: String(it.view), url: `data:image/png;base64,${it.png_b64}`, box: it.box });
    }
    captures.set(sha, store);
    return out(200, { saved: items.length });
  }
  return out(405, { detail: 'method not allowed' });
}
