// Button / IconButton (spec §6.5). Accent appears only on what can be
// pressed; a disabled button loses it. Heights sm 24 / md 32 / lg 40, radius
// --radius-control. `loading` keeps the label, adds a spinner and aria-busy.
// Press feedback is a 0.97 scale over DUR.instant (reduced motion: none).

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { DUR } from '../theme/motion';
import './i18n';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-6 gap-1 px-2 text-[12px]',
  md: 'h-8 gap-1.5 px-3 text-[13px]',
  lg: 'h-10 gap-2 px-4 text-[14px]',
};
const VARIANT: Record<ButtonVariant, string> = {
  primary: 'border border-transparent bg-accent text-on-accent hover:bg-[color-mix(in_oklch,var(--color-accent),var(--color-ink)_12%)]',
  secondary: 'border border-line-strong bg-panel text-ink hover:bg-panel-2',
  ghost: 'border border-transparent bg-transparent text-ink hover:bg-panel-2',
  danger: 'border border-transparent bg-[var(--color-danger-bright)] text-white hover:bg-[color-mix(in_oklch,var(--color-danger-bright),black_12%)]',
};
const DISABLED = 'disabled:cursor-not-allowed disabled:border-line disabled:bg-panel-2 disabled:text-ink-4';

type Native = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onAnimationStart' | 'onDrag' | 'onDragStart' | 'onDragEnd'>;

export interface ButtonProps extends Native {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

function Spinner() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5 animate-spin">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity=".3" strokeWidth="2" />
      <path d="M14 8a6 6 0 0 0-6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Button({ variant = 'secondary', size = 'md', loading = false, icon, className = '', children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <motion.button
      type={type}
      whileTap={disabled || loading ? undefined : { scale: 0.97 }}
      transition={{ duration: DUR.instant }}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-control font-semibold whitespace-nowrap transition-colors ${SIZE[size]} ${VARIANT[variant]} ${DISABLED} ${className}`}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </motion.button>
  );
}

const ICON_SIZE: Record<ButtonSize, string> = { sm: 'h-6 w-6', md: 'h-8 w-8', lg: 'h-10 w-10' };

/** Icon-only button: the label is required and becomes the accessible name
 *  and the hover title (an unlabeled icon button is the classic a11y miss). */
export function IconButton({ label, size = 'md', variant = 'ghost', className = '', children, ...rest }: Omit<ButtonProps, 'icon'> & { label: string }) {
  const { t } = useTranslation();
  return (
    <Button
      variant={variant} size={size} aria-label={rest.loading ? `${label} — ${t('kit.loading')}` : label} title={label}
      className={`!px-0 ${ICON_SIZE[size]} ${className}`} {...rest}
    >
      {children}
    </Button>
  );
}
