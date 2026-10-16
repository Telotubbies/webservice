// REST client for cameras, demo videos and the signed stream URL
// (backend/app/vision/{cameras,videos,stream}.py).

import { request, requestBlob } from '../../lib/api';

export interface Camera {
  id: string; edge_id: string; name: string; kind: 'rtsp' | 'upload'; has_rtsp_url: boolean;
  video_id: string | null; fps_sample: number; enabled: boolean;
  status: 'unknown' | 'ok' | 'error'; status_detail: string | null; status_at: string | null;
  // live model metadata merged from the edge's last vision/stat (absent when stale)
  engine?: string; latency_ms?: number; bench_fps?: number;
  model_state?: 'none' | 'loading' | 'ready' | 'error';
  model_detail?: string; model_version?: string;
}
export interface Video { id: string; filename: string; size_bytes: number; sha256: string; created_at: string }

const call = request;

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
  snapshot: (o: string, id: string, signal?: AbortSignal) =>
    requestBlob(`${org(o)}/cameras/${id}/snapshot`, { signal }).then((r) => r.blob),
};
