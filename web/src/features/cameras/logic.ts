// Pure helpers for the Cameras page (unit-tested in logic.test.ts).

// Mirrors the backend upload cap — the 200 MB figure also appears in copy
// (cam.fFile, cam.errSize), so keep all three in step.
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

/** The backend closes an MJPEG stream after 1 h; open a fresh one before that. */
export function streamRefreshMs(expiresInS = 3000): number {
  return Math.max(5_000, expiresInS * 1000);
}

/** null = ok. Mirrors the backend (rtsp:// or rtsps:// with a host). */
export function rtspError(url: string): 'required' | 'scheme' | null {
  const u = url.trim();
  if (!u) return 'required';
  return /^rtsps?:\/\/[^/\s]+/i.test(u) ? null : 'scheme';
}

/** null = ok. The edge only accepts mp4/webm containers for looping clips. */
export function videoUploadError(f: { type: string; size: number }): 'type' | 'size' | null {
  if (f.type !== 'video/mp4' && f.type !== 'video/webm') return 'type';
  return f.size > 0 && f.size <= MAX_VIDEO_BYTES ? null : 'size';
}

export interface CameraForm {
  kind: 'rtsp' | 'upload'; name: string; rtspUrl?: string; videoId?: string; fps: string;
}

/** Form → POST body. fps_sample clamps to the backend's 0.5..15 window and
 *  each kind sends only its own field (rtsp_url XOR video_id). */
export function buildCameraBody(f: CameraForm) {
  const n = Number(f.fps);
  const fps_sample = Number.isFinite(n) && f.fps.trim() !== '' ? Math.min(15, Math.max(0.5, n)) : 5;
  const base = { name: f.name.trim(), kind: f.kind, fps_sample };
  return f.kind === 'rtsp'
    ? { ...base, rtsp_url: (f.rtspUrl ?? '').trim() }
    : { ...base, video_id: f.videoId ?? '' };
}
