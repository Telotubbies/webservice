import type { TFunction } from 'i18next';
import type { PageTab } from '../../shared/ui/Page';

/** Route tabs shared by the Infrastructure pages (list, map, profiles). */
export const DEVICE_TABS = (t: TFunction): PageTab[] => [
  { to: '/infrastructure', label: t('dev.tabDevices'), end: true },
  { to: '/infrastructure/map', label: t('dev.tabMap') },
  { to: '/infrastructure/profiles', label: t('dev.tabProfiles') },
];
