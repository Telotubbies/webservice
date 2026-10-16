import type { TFunction } from 'i18next';
import type { PageTab } from '../../shared/ui/Page';
import '../datasources/i18n';
import '../cameras/i18n';
import '../vision/i18n';

/** Route tabs shared by the Infrastructure pages (list, map, profiles). */
export const DEVICE_TABS = (t: TFunction): PageTab[] => [
  { to: '/infrastructure', label: t('dev.tabDevices'), end: true },
  { to: '/infrastructure/sources', label: t('ds.tab') },
  { to: '/infrastructure/cameras', label: t('cam.tab') },
  { to: '/infrastructure/models', label: t('vis.tab') },
  { to: '/infrastructure/map', label: t('dev.tabMap') },
  { to: '/infrastructure/profiles', label: t('dev.tabProfiles') },
];
