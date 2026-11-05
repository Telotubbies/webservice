// Data-source templates: a recipe the owner applies with one click. Pure data
// (the dashboard is referenced by id from features/dashboards/templates.ts and
// resolved by apply.ts). Tags mirror the `modbus:` block of edge-bridge/tags.yaml.
//
// Naming: the console API builds tag paths as line/device/signal (3 segments),
// so `sort.line1.motor1.running` becomes line=sort device=motor1 signal=running
// (the redundant `line1` segment is dropped).

import type { SourceTemplate, TagDraft } from './logic';

const tag = (device: string, signal: string, address: string, over: Partial<TagDraft> = {}): TagDraft => ({
  line: 'sort', device, signal, address, type: 'number', unit: '', writable: false, min: null, max: null, scale: null, ...over,
});

export const factoryioSorting: SourceTemplate = {
  id: 'factoryioSorting',
  source: { name: 'Factory I/O - Sorting', protocol: 'modbus', connection: { host: 'host.docker.internal', port: 502, unit_id: 1 }, poll_ms: 1000 },
  tags: [
    tag('motor1', 'running', '%QX0.0', { type: 'bool', writable: true }),
    tag('motor1', 'speed_sp', '%QW2', { unit: 'Hz', writable: true, scale: 0.1, min: 0, max: 60 }),
    tag('conv1', 'speed_mps', '%IW4', { unit: 'm/s', scale: 0.01 }),
    tag('conv1', 'temp_c', '%IW6', { unit: 'degC', scale: 0.1 }),
    tag('bin1', 'level_pct', '%IW8', { unit: '%' }),
    tag('cam1', 'gravel_ratio', '%IW10', { scale: 0.001 }),
    // extra writable coil for the vision demo (pusher rejects a defective part)
    tag('pusher1', 'extend', '%QX0.1', { type: 'bool', writable: true }),
  ],
  dashboardTemplateId: 'processMetrics',
  rules: [
    { name: 'Belt temperature high', path: 'sort/conv1/temp_c', kind: 'hi', threshold: 75, severity: 'critical' },
    { name: 'Bin nearly full', path: 'sort/bin1/level_pct', kind: 'hi', threshold: 90, severity: 'warning' },
  ],
};

export const TEMPLATES: SourceTemplate[] = [factoryioSorting];
