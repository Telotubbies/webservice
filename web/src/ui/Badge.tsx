// Badge and Kbd. Status badges always carry a shape and a word — the glyph
// takes the status colour, the text stays in ink (text wears text tokens),
// so a badge reads in greyscale and for colour-blind operators.

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import './i18n';

export type BadgeTone = 'neutral' | 'accent' | 'crit' | 'warn' | 'info' | 'ok' | 'sim';

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-panel-2 text-ink-2',
  accent: 'bg-accent-soft text-ink',
  crit: 'bg-crit-soft text-ink',
  warn: 'bg-warn-soft text-ink',
  info: 'bg-panel-2 text-ink',
  ok: 'bg-[var(--color-ok-soft)] text-ink',
  sim: 'border border-dashed border-sim bg-transparent text-ink',
};
const GLYPH: Partial<Record<BadgeTone, { g: string; cls: string }>> = {
  crit: { g: '▲', cls: 'text-crit' },
  warn: { g: '◆', cls: 'text-warn-ink' },
  info: { g: '●', cls: 'text-info' },
  ok: { g: '✓', cls: 'text-ok' },
};

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children?: ReactNode }) {
  const { t } = useTranslation();
  const glyph = GLYPH[tone];
  return (
    <span className={`inline-flex h-5 items-center gap-1 rounded-[4px] px-1.5 text-[11px] font-semibold whitespace-nowrap ${TONE[tone]}`}>
      {glyph && <span aria-hidden className={`text-[9px] ${glyph.cls}`}>{glyph.g}</span>}
      {children ?? (tone === 'sim' ? t('kit.sim') : null)}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border border-line-strong bg-panel-2 px-1 font-mono text-[10px] font-semibold text-ink-2">
      {children}
    </kbd>
  );
}
