// REST client for cameras, demo videos and the signed stream URL
// (backend/app/vision/{cameras,videos,stream}.py).

import { ApiError, getToken } from '../../lib/api';

export interface Camera {
  id: string; edge_id: string; name: string; kind: 'rtsp' | 'upload'; has_rtsp_url: boolean;
  video_id: string | null; fps_sample: number; enabled: boolean;
  status: 'unknown' | 'ok' | 'error'; status_detail: string | null; status_at: string | null;
}
export interface Video { id: string; filename: string; size_bytes: number; sha256: string; created_at: string }

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers as Record<string, string>) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...init, headers });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const d = data && typeof data === 'object' && 'detail' in data ? String((data as { detail: unknown }).detail) : undefined;
    throw new ApiError(res.status, data, d ?? `HTTP ${res.status}`);
  }
  return data as T;
}

const org = (o: string) => `/api/v1/orgs/${encodeURIComponent(o)}`;
const json = (method: string, body: unknown): RequestInit => ({
  method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
});

export const camApi = {
  cameras: (o: string, edge: string) => call<{ items: Camera[] }>(`${org(o)}/edges/${edge}/cameras`),
  create: (o: string, edge: string, body: Record<string, unknown>) =>
    call<{ camera: Camera }>(`${org(o)}/edges/${edge}/cameras`, json('POST', body)),
  remove: (o: string, edge: string, id: string) =>
    call<void>(`${org(o)}/edges/${edge}/cameras/${id}`, { method: 'DELETE' }),
  setEnabled: (o: string, edge: string, id: string, enabled: boolean) =>
    call<{ camera: Camera }>(`${org(o)}/edges/${edge}/cameras/${id}`, json('PATCH', { enabled })),
  uploadVideo: (o: string, site: string, file: File) =>
    call<Video>(`${org(o)}/sites/${site}/videos?filename=${encodeURIComponent(file.name)}`,
      { method: 'POST', body: file, headers: { 'Content-Type': file.type } }),
  deleteVideo: (o: string, site: string, id: string) =>
    call<void>(`${org(o)}/sites/${site}/videos/${id}`, { method: 'DELETE' }),
  streamUrl: (o: string, id: string) =>
    call<{ url: string; expires_in: number }>(`${org(o)}/cameras/${id}/stream-url`, { method: 'POST' }),
};
