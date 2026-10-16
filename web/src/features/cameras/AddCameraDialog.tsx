// Add a camera: an RTSP URL, or an uploaded clip that loops like a live feed.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { ApiError } from '../../lib/api';
import { Notice } from '../../shared/ui/Feedback';
import { camApi } from './api';
import { buildCameraBody, rtspError, videoUploadError } from './logic';
import './i18n';

export function AddCameraDialog({ orgId, siteId, edgeId, onDone, onCancel }: {
  orgId: string; siteId: string; edgeId: string; onDone: () => void; onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<'rtsp' | 'upload'>('upload');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fps, setFps] = useState('5');
  const [fail, setFail] = useState('');
  const [touched, setTouched] = useState(false);

  const urlErr = kind === 'rtsp' ? rtspError(url) : null;
  const fileErr = kind === 'upload' ? (file ? videoUploadError(file) : 'required') : null;
  const valid = name.trim() !== '' && !urlErr && !fileErr;
  const errText = (e: string | null) => e && t(`cam.err${e[0].toUpperCase()}${e.slice(1)}`);

  const save = useMutation({
    mutationFn: async () => {
      let videoId: string | undefined;
      if (kind === 'upload' && file) videoId = (await camApi.uploadVideo(orgId, siteId, file)).id;
      try {
        await camApi.create(orgId, edgeId, buildCameraBody({ kind, name, rtspUrl: url, videoId, fps }));
      } catch (e) {
        if (videoId) await camApi.deleteVideo(orgId, siteId, videoId).catch(() => undefined); // no orphan clip
        throw e;
      }
    },
    onSuccess: onDone,
    onError: (e) => {
      if (e instanceof ApiError) {
        setFail(e.status === 415 ? t('cam.errUnsupported') : e.status === 413 ? t('cam.errTooLarge')
          : e.status === 409 ? t('cam.errNameExists') : t('cam.errGeneric', { reason: e.message }));
      } else setFail(t('dev.errNetwork'));
    },
  });

  return (
    <form className="rounded-[5px] border border-line bg-white p-4" onSubmit={(e) => { e.preventDefault(); setTouched(true); if (valid) { setFail(''); save.mutate(); } }}>
      <h2 className="mb-3 text-[15px] font-semibold">{t('cam.add')}</h2>
      <div role="radiogroup" aria-label={t('cam.add')} className="grid gap-2 sm:grid-cols-2">
        {(['upload', 'rtsp'] as const).map((k) => (
          <label key={k} className={`cursor-pointer rounded-[5px] border p-3 ${kind === k ? 'border-blue bg-info-soft' : 'border-line hover:border-line-hard'}`}>
            <input type="radio" name="cam-kind" className="sr-only" checked={kind === k} onChange={() => setKind(k)} />
            <span className="block text-[13px] font-semibold">{t(k === 'rtsp' ? 'cam.kindRtsp' : 'cam.kindUpload')}</span>
            <span className="block text-[12px] text-ink-68">{t(k === 'rtsp' ? 'cam.kindRtspHint' : 'cam.kindUploadHint')}</span>
          </label>
        ))}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="field-label" htmlFor="cam-name">{t('cam.fName')}</label>
          <input id="cam-name" className="input h-8 w-full" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} aria-invalid={(touched && !name.trim()) || undefined} />
          {touched && !name.trim() && <p className="mt-0.5 text-[12px] text-[var(--color-danger)]">{t('cam.errRequired')}</p>}
        </div>
        <div>
          <label className="field-label" htmlFor="cam-fps">{t('cam.fFps')}</label>
          <input id="cam-fps" className="input h-8 w-full" type="number" min={0.5} max={15} step={0.5} value={fps} onChange={(e) => setFps(e.target.value)} />
        </div>
        {kind === 'rtsp' ? (
          <div className="sm:col-span-2">
            <label className="field-label" htmlFor="cam-url">{t('cam.fUrl')}</label>
            <input id="cam-url" className="input h-8 w-full font-mono" autoComplete="off" spellCheck={false} value={url} placeholder="rtsp://192.168.0.20:554/stream1"
              onChange={(e) => setUrl(e.target.value)} aria-invalid={(touched && !!urlErr) || undefined} />
            <p className="mt-0.5 text-[12px] text-ink-68">{t('cam.fUrlHint')}</p>
            {touched && urlErr && <p className="mt-0.5 text-[12px] text-[var(--color-danger)]">{errText(urlErr)}</p>}
          </div>
        ) : (
          <div className="sm:col-span-2">
            <label className="field-label" htmlFor="cam-file">{t('cam.fFile')}</label>
            <input id="cam-file" className="input w-full" type="file" accept="video/mp4,video/webm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-invalid={(touched && !!fileErr) || undefined} />
            {touched && fileErr && <p className="mt-0.5 text-[12px] text-[var(--color-danger)]">{errText(fileErr)}</p>}
          </div>
        )}
      </div>
      {fail && <div className="mt-3"><Notice tone="error">{fail}</Notice></div>}
      <div className="mt-3 flex gap-2">
        <button type="submit" className="btn" disabled={save.isPending}>
          {save.isPending ? (kind === 'upload' ? t('cam.uploading') : t('cam.saving')) : t('cam.save')}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={save.isPending}>{t('cam.cancel')}</button>
      </div>
    </form>
  );
}
