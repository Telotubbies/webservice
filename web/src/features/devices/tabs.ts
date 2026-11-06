// Shared tab bars: Connectivity (devices, data sources, map, profiles) and
// Vision AI (cameras, models, rules, events) — the same split as the rail.

import type { TFunction } from 'i18next';
import type { PageTab } from '../../shared/ui/Page';
// Side-effect imports: the tab labels live in sibling features' namespaces,
// so their i18n resources must be registered before the labels resolve.
import '../datasources/i18n';
import '../cameras/i18n';
import '../vision/i18n';

/** Route tabs of the Connectivity pages (devices, sources, map, profiles). */
export const DEVICE_TABS = (t: TFunction): PageTab[] => [
  { to: '/connect/gateways', label: t('dev.tabDevices'), end: true },
  { to: '/connect/sources', label: t('ds.tab') },
  { to: '/connect', label: t('dev.tabMap'), end: true },
  { to: '/connect/profiles', label: t('dev.tabProfiles') },
];

/** Route tabs of the Vision AI pages. */
export const VISION_TABS = (t: TFunction): PageTab[] => [
  { to: '/vision/cameras', label: t('cam.tab') },
  { to: '/vision/models', label: t('vis.tab') },
  { to: '/vision/rules', label: t('vis.rulesTab') },
  { to: '/vision/events', label: t('vis.eventsTab') },
  { to: '/vision/quality', label: t('vis.qualityTab') },
];
