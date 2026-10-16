// One live tile: the MJPEG <img> is opened with a 60 s signed URL and
// re-opened before the server's 1 h stream cap.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { camApi, type Camera } from './api';
import { streamRefreshMs } from './logic';
import '../vision/i18n';
import './i18n';

export function CameraTile({ orgId, cam, admin, onToggle, onDelete, onModel }: {
  orgId: string; cam: Camera; admin: boolean;
  onToggle: (c: Camera) => void; onDelete: (c: Camera) => void; onModel: (c: Camera) => void;
}) {
  const { t } = useTranslation();
  const [src, setSrc] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!cam.enabled) { setSrc(null); return; }
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const open = async () => {
      try {
        await camApi.streamUrl(orgId, cam.id).then((r) => { if (alive) { setSrc(r.url); setBroken(false); } });
      } catch { if (alive) setBroken(true); }
      if (alive) timer = setTimeout(open, broken ? 5_000 : streamRefreshMs());
    };
    void open();
    return () => { alive = false; clearTimeout(timer); };
  }, [orgId, cam.id, cam.enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // a decoded frame is the best proof of life; the gateway's own status follows within ~20 s
  const label = !cam.enabled ? t('cam.disabled') : cam.status === 'ok' || (loaded && cam.status !== 'error') ? t('cam.statusOk')
    : cam.status === 'error' ? t('cam.statusError') : t('cam.statusUnknown');
  const tone = !cam.enabled ? 'text-ink-46'
    : cam.status === 'error' ? 'text-[var(--color-danger)]'
    : cam.status === 'ok' || loaded ? 'text-[var(--color-success,#1a7f37)]' : 'text-ink-46';

  return (
    <figure className="overflow-hidden rounded-[5px] border border-line bg-white">
      <div className="relative aspect-video bg-ink/90">
        {src ? (
          <img src={src} alt={cam.name} className="h-full w-full object-contain" onError={() => { setBroken(true); setLoaded(false); }} onLoad={() => { setBroken(false); setLoaded(true); }} />
        ) : null}
        {(!src || broken) && (
          <p className="absolute inset-0 flex items-center justify-center px-3 text-center text-[12px] text-white/80" role="status">
            {!cam.enabled ? t('cam.disabled') : broken ? t('cam.streamLost') : t('cam.waiting')}
          </p>
        )}
      </div>
      <figcaption className="flex items-start justify-between gap-2 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium">{cam.name}</p>
          <p className={`text-[12px] ${tone}`}>{label}{cam.status === 'error' && cam.status_detail ? ` — ${cam.status_detail}` : ''}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onModel(cam)}>{t('vis.panelTitle')}</button>
          {admin && (<>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => onToggle(cam)}>
              {cam.enabled ? t('cam.disable') : t('cam.enable')}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" aria-label={`${t('cam.delete')} — ${cam.name}`} onClick={() => onDelete(cam)}>
              <Trash2 size={14} aria-hidden />
            </button>
          </>)}
        </div>
      </figcaption>
    </figure>
  );
}
