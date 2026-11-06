// API usage keys -> `plat.*` copy keys. Both the capped names (max_*) and the
// bare usage names the API returns map to a label; an unknown key still gets a
// readable label instead of a raw i18n key.
const CAP_LABEL: Record<string, string> = {
  max_sites: 'capSites', max_edges: 'capEdges', max_tags: 'capTags',
  max_users: 'capUsers', max_cameras: 'capCameras', max_vision_models: 'capModels',
  gpu_hours_monthly: 'capGpu',
  sites: 'capSites', edges: 'capEdges', tags: 'capTags', members: 'capUsers',
  cameras: 'capCameras', vision_models: 'capModels', gpu_hours: 'capGpu', storage_gb: 'capStorage',
};

export function capLabelKey(k: string): string {
  return CAP_LABEL[k] ?? 'capOther';
}
