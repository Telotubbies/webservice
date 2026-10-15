// Ready-made boards, the plant-ops answer to Datadog's prebuilt integration
// dashboards (monitor alerts overview, reliability by service/team, system and
// host metrics, host counts). A template is a recipe; "Use template" copies it
// into a custom board the user then owns and can edit.

import { SIGNALS } from '../../lib/plant';
import { makeWidget, type Widget, type RangeKey } from './model';

export interface DashTemplate {
  id: string;           // i18n key suffix: dash.tpl_<id> / dash.tpl_<id>_d
  range: RangeKey;
  build: () => Widget[];
}

const T = {
  running: 'plant1.sort.line1.motor1.running',
  sp: 'plant1.sort.line1.motor1.speed_sp',
  speed: 'plant1.sort.line1.conv1.speed_mps',
  temp: 'plant1.sort.line1.conv1.temp_c',
  bin: 'plant1.sort.line1.bin1.level_pct',
  gravel: 'plant1.sort.vision.cam1.gravel_ratio',
};
const w = makeWidget;

export const DASH_TEMPLATES: DashTemplate[] = [
  { id: 'alarmOverview', range: '24h', build: () => [
    w('monitors', { title: 'Signal status', x: 0, y: 0, w: 4 }),
    w('toplist', { title: 'Alarms by severity', groupBy: 'severity', x: 4, y: 0, w: 4 }),
    w('pie', { title: 'Alarms by signal', groupBy: 'tag', x: 8, y: 0, w: 4 }),
    w('toplist', { title: 'Noisiest rules', groupBy: 'rule', x: 0, y: 3, w: 4 }),
    w('alarms', { title: 'Open alarms', x: 4, y: 3, w: 8 }),
  ] },
  { id: 'reliability', range: '24h', build: () => [
    w('slo', { title: 'Availability SLO', x: 0, y: 0, w: 6 }),
    w('monitors', { title: 'Signal status', x: 6, y: 0, w: 6 }),
    w('toplist', { title: 'Alarms by signal', groupBy: 'tag', x: 0, y: 2, w: 6 }),
    w('toplist', { title: 'Alarms by rule', groupBy: 'rule', x: 6, y: 2, w: 6 }),
  ] },
  { id: 'processMetrics', range: '1h', build: () => [
    w('value', { title: 'Belt speed', tags: [T.speed], decimals: 2, x: 0, y: 0 }),
    w('value', { title: 'Belt temperature', tags: [T.temp], warn: 70, crit: 75, x: 3, y: 0 }),
    w('value', { title: 'Bin level', tags: [T.bin], decimals: 0, warn: 85, crit: 90, x: 6, y: 0 }),
    w('value', { title: 'Speed setpoint', tags: [T.sp], x: 9, y: 0 }),
    w('timeseries', { title: 'Speed and setpoint', tags: [T.speed, T.sp], x: 0, y: 2, w: 12 }),
    w('timeseries', { title: 'Belt temperature (°C)', tags: [T.temp], warn: 70, crit: 75, x: 0, y: 5 }),
    w('timeseries', { title: 'Bin fill (%)', tags: [T.bin], yMin: 0, yMax: 100, warn: 85, crit: 90, x: 6, y: 5 }),
  ] },
  { id: 'drive', range: '4h', build: () => [
    w('stateline', { title: 'Motor running', tags: [T.running], x: 0, y: 0, w: 12 }),
    w('gauge', { title: 'Setpoint', tags: [T.sp], x: 0, y: 2 }),
    w('gauge', { title: 'Belt speed', tags: [T.speed], x: 4, y: 2 }),
    w('timeseries', { title: 'Setpoint vs speed', tags: [T.sp, T.speed], x: 8, y: 2, w: 4 }),
    w('change', { title: 'Speed change', tags: [T.speed], x: 0, y: 5 }),
    w('histogram', { title: 'Speed distribution', tags: [T.speed], x: 3, y: 5, w: 5 }),
  ] },
  { id: 'thermal', range: '4h', build: () => [
    w('gauge', { title: 'Belt temperature', tags: [T.temp], warn: 70, crit: 75, x: 0, y: 0 }),
    w('change', { title: 'Temperature change', tags: [T.temp], x: 4, y: 0 }),
    w('histogram', { title: 'Temperature distribution', tags: [T.temp], x: 7, y: 0, w: 5 }),
    w('timeseries', { title: 'Belt temperature (°C)', tags: [T.temp], warn: 70, crit: 75, x: 0, y: 3, w: 12 }),
  ] },
  { id: 'signalCounts', range: '1h', build: () => [
    w('monitors', { title: 'Signals by state', x: 0, y: 0, w: 4 }),
    w('table', { title: 'All signals', tags: Object.keys(SIGNALS), x: 4, y: 0, w: 8, h: 4 }),
  ] },
  { id: 'quality', range: '4h', build: () => [
    w('value', { title: 'Gravel ratio', tags: [T.gravel], decimals: 0, x: 0, y: 0 }),
    w('bargauge', { title: 'Gravel and bin level', tags: [T.gravel, T.bin], x: 3, y: 0, w: 9 }),
    w('timeseries', { title: 'Gravel ratio (%)', tags: [T.gravel], decimals: 0, yMin: 0, yMax: 100, x: 0, y: 2, w: 12 }),
  ] },
  { id: 'shift', range: '24h', build: () => [
    w('note', { title: 'Shift notes', note: '## Shift handover\n\n- Open issues:\n- Maintenance done:\n- Watch next shift:', x: 0, y: 0, w: 4, h: 3 }),
    w('slo', { title: 'Availability SLO', x: 4, y: 0, w: 4 }),
    w('monitors', { title: 'Signal status', x: 8, y: 0, w: 4 }),
    w('alarms', { title: 'Open alarms', x: 4, y: 2, w: 8 }),
    w('timeseries', { title: 'Belt temperature (°C)', tags: [T.temp], warn: 70, crit: 75, x: 0, y: 5 }),
    w('timeseries', { title: 'Belt speed (m/s)', tags: [T.speed], x: 6, y: 5 }),
  ] },
];
