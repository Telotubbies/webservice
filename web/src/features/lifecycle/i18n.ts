// Copy for the data lifecycle page. Namespaced `lc`.

import i18n from '../../lib/i18n';

const en = {
  title: 'Data lifecycle', lede: 'How long each kind of data is kept, and the archives written before old telemetry is removed.',
  policy: 'Retention', telemetry: 'Telemetry history: {{count}} days (set by your plan).', days: '{{count}} days', off: 'Not deleted',
  c_alarms_cleared: 'Cleared alarms', c_downtimes: 'Downtimes', c_vision_events: 'Vision events', c_edge_logs: 'Gateway logs',
  c_outbox_sent: 'Delivered integration messages', c_org_exports_expired: 'Expired export records',
  auditNote: 'The audit trail is never trimmed while your organisation exists, so its hash chain stays whole.',
  archives: 'Verified archives', noArchives: 'No archives yet. A month is archived and checked before its telemetry is dropped.',
  month: 'Month', rows: 'Rows', verified: 'Verified',
};
const th = {
  title: 'วงจรชีวิตข้อมูล', lede: 'ข้อมูลแต่ละประเภทเก็บนานเท่าไร และไฟล์ archive ที่เขียนไว้ก่อนลบ telemetry เก่า',
  policy: 'ระยะเวลาเก็บ', telemetry: 'ประวัติ telemetry: {{count}} วัน (ตามแพลนของคุณ)', days: '{{count}} วัน', off: 'ไม่ลบ',
  c_alarms_cleared: 'การแจ้งเตือนที่เคลียร์แล้ว', c_downtimes: 'ช่วงหยุดเครื่อง', c_vision_events: 'เหตุการณ์ Vision', c_edge_logs: 'บันทึกของเกตเวย์',
  c_outbox_sent: 'ข้อความเชื่อมระบบที่ส่งแล้ว', c_org_exports_expired: 'รายการส่งออกที่หมดอายุ',
  auditNote: 'บันทึกตรวจสอบจะไม่ถูกตัดตราบที่องค์กรของคุณยังอยู่ โซ่แฮชจึงครบ',
  archives: 'archive ที่ตรวจแล้ว', noArchives: 'ยังไม่มี archive ระบบจะ archive และตรวจสอบรายเดือนก่อนลบ telemetry',
  month: 'เดือน', rows: 'แถว', verified: 'ตรวจเมื่อ',
};

i18n.addResourceBundle('en', 'translation', { lc: en }, true, true);
i18n.addResourceBundle('th', 'translation', { lc: th }, true, true);
