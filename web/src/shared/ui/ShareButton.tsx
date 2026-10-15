// Share (F21) — snapshot permalink + PNG export. The URL already carries
// the view (filters, window, selection), so "share" copies the absolute
// URL. Where a chart exists, the PNG composes the uPlot canvas onto an
// opaque white card with a title, the time range, a legend and the capture
// time — a bare transparent canvas would be unreadable once pasted.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link2 } from 'lucide-react';
import { DdIcon } from './DdIcon';
import { csvName } from './ExportCsv';
import './explorerI18n';

export interface PngSpec {
  canvas: HTMLCanvasElement;
  title: string;
  subtitle?: string;
  legend?: { label: string; color: string; dashed?: boolean }[];
  /** file base name; a timestamp is appended */
  name: string;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Compose a chart canvas onto a labelled white card and download it. */
export function downloadChartPng(spec: PngSpec, takenLabel: string): void {
  const src = spec.canvas;
  const dpr = window.devicePixelRatio || 1;
  const padX = 16 * dpr;
  const head = (spec.subtitle ? 46 : 30) * dpr;
  const legendH = spec.legend?.length ? 22 * dpr : 0;
  const foot = 20 * dpr;
  const out = document.createElement('canvas');
  out.width = src.width + padX * 2;
  out.height = src.height + head + legendH + foot;
  const ctx = out.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgb(28 43 52)';
  ctx.font = `600 ${14 * dpr}px "IBM Plex Sans", "IBM Plex Sans Thai", sans-serif`;
  ctx.fillText(spec.title, padX, 10 * dpr);
  if (spec.subtitle) {
    ctx.fillStyle = '#4f5b65';
    ctx.font = `${12 * dpr}px "IBM Plex Sans", "IBM Plex Sans Thai", sans-serif`;
    ctx.fillText(spec.subtitle, padX, 28 * dpr);
  }
  let x = padX;
  const ly = head + 4 * dpr;
  ctx.font = `${11 * dpr}px "IBM Plex Sans", "IBM Plex Sans Thai", sans-serif`;
  for (const l of spec.legend ?? []) {
    ctx.strokeStyle = l.color;
    ctx.lineWidth = 2 * dpr;
    ctx.setLineDash(l.dashed ? [4 * dpr, 3 * dpr] : []);
    ctx.beginPath();
    ctx.moveTo(x, ly + 6 * dpr);
    ctx.lineTo(x + 14 * dpr, ly + 6 * dpr);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#4f5b65';
    ctx.fillText(l.label, x + 18 * dpr, ly);
    x += 18 * dpr + ctx.measureText(l.label).width + 16 * dpr;
  }
  ctx.drawImage(src, padX, head + legendH);
  ctx.fillStyle = '#5d6670';
  ctx.font = `${10 * dpr}px "IBM Plex Sans", "IBM Plex Sans Thai", sans-serif`;
  ctx.fillText(takenLabel, padX, out.height - 15 * dpr);
  const a = document.createElement('a');
  a.href = out.toDataURL('image/png');
  a.download = `${csvName(spec.name)}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function ShareButton({ png }: {
  /** returns the chart to export, or null when no chart is on screen */
  png?: () => PngSpec | null;
}) {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const url = typeof window !== 'undefined' ? window.location.href : '';

  const share = async () => {
    const ok = await copyText(window.location.href);
    setState(ok ? 'copied' : 'failed');
    if (ok) window.setTimeout(() => setState('idle'), 2000);
  };

  const snapshot = () => {
    const spec = png?.();
    if (!spec) return;
    const taken = new Date().toLocaleString(i18n.language.startsWith('th') ? 'th-TH' : 'en-GB', { hour12: false });
    downloadChartPng(spec, t('xp.pngTaken', { time: taken }));
  };

  return (
    <span className="share-tools relative inline-flex items-center gap-1">
      <button type="button" className="btn btn-sm btn-ghost share-btn" title={t('xp.shareTitle')} onClick={() => void share()}>
        {state === 'copied' ? <DdIcon name="check" size={13} /> : <Link2 size={13} strokeWidth={1.75} aria-hidden />}
        {state === 'copied' ? t('share.copied') : t('share.copy')}
      </button>
      {png && (
        <button type="button" className="btn btn-sm btn-ghost share-png" title={t('xp.pngTitle')} onClick={snapshot}>
          <DdIcon name="download" size={13} /> PNG
        </button>
      )}
      <span className="sr-only" aria-live="polite">{state === 'copied' ? t('share.copied') : ''}</span>
      {state === 'failed' && (
        <span className="xp-pop absolute right-0 top-full z-30 mt-1 w-[320px] max-w-[calc(100vw-24px)] rounded-dd border border-line bg-white p-3 shadow-flyout" role="alert">
          <span className="mb-2 block text-[12px] text-ink-68">{t('xp.copyFailed')}</span>
          <input
            className="input h-7 w-full font-mono text-[11px]"
            readOnly
            value={url}
            aria-label={t('share.copy')}
            ref={(el) => el?.select()}
            onBlur={() => setState('idle')}
          />
        </span>
      )}
    </span>
  );
}
