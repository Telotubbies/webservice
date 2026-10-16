import { describe, expect, test } from 'bun:test';
import { buildCameraBody, rtspError, streamRefreshMs, videoUploadError } from './logic';

describe('streamRefreshMs', () => {
  test('re-opens well before the 1 h stream cap, never in a tight loop', () => {
    expect(streamRefreshMs()).toBe(50 * 60_000);
    expect(streamRefreshMs(0)).toBeGreaterThanOrEqual(5_000);
  });
});

describe('rtspError', () => {
  test('accepts rtsp(s) with a host, rejects the rest', () => {
    expect(rtspError('rtsp://10.0.0.5:554/stream1')).toBeNull();
    expect(rtspError('rtsps://user:pw@cam.local/s')).toBeNull();
    expect(rtspError('')).toBe('required');
    expect(rtspError('http://10.0.0.5/s')).toBe('scheme');
    expect(rtspError('rtsp://')).toBe('scheme');
    expect(rtspError('file:///etc/passwd')).toBe('scheme');
  });
});

describe('buildCameraBody', () => {
  test('rtsp carries the url, never a video id', () => {
    expect(buildCameraBody({ kind: 'rtsp', name: ' Belt ', rtspUrl: ' rtsp://h/s ', fps: '5' }))
      .toEqual({ name: 'Belt', kind: 'rtsp', rtsp_url: 'rtsp://h/s', fps_sample: 5 });
  });
  test('upload carries the video id, never a url', () => {
    expect(buildCameraBody({ kind: 'upload', name: 'Demo', videoId: 'v1', fps: '2.5' }))
      .toEqual({ name: 'Demo', kind: 'upload', video_id: 'v1', fps_sample: 2.5 });
  });
  test('fps is clamped to the backend range 0.5..15', () => {
    expect(buildCameraBody({ kind: 'rtsp', name: 'a', rtspUrl: 'rtsp://h/s', fps: '99' }).fps_sample).toBe(15);
    expect(buildCameraBody({ kind: 'rtsp', name: 'a', rtspUrl: 'rtsp://h/s', fps: '0' }).fps_sample).toBe(0.5);
    expect(buildCameraBody({ kind: 'rtsp', name: 'a', rtspUrl: 'rtsp://h/s', fps: 'abc' }).fps_sample).toBe(5);
  });
});

describe('videoUploadError', () => {
  test('rejects wrong type and oversize before uploading', () => {
    expect(videoUploadError({ type: 'video/mp4', size: 1000 })).toBeNull();
    expect(videoUploadError({ type: 'video/webm', size: 1000 })).toBeNull();
    expect(videoUploadError({ type: 'image/png', size: 1000 })).toBe('type');
    expect(videoUploadError({ type: 'video/mp4', size: 201 * 1024 * 1024 })).toBe('size');
    expect(videoUploadError({ type: 'video/mp4', size: 0 })).toBe('size');
  });
});
