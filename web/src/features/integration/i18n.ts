// Copy for the Integration page. Namespaced `int`.

import i18n from '../../lib/i18n';

const en = {
  title: 'Integration', lede: 'What was sent to your ERP or webhooks, what failed, and the closed shift and hour totals behind it.',
  outbox: 'Deliveries', filter: 'Status', all: 'All', st_pending: 'Waiting', st_sent: 'Sent', st_dead: 'Failed for good',
  noOutbox: 'Nothing queued yet. Deliveries appear after a shift or hour closes and a webhook subscribes to it.',
  col_when: 'Queued', col_event: 'Event', col_status: 'Status', col_attempts: 'Tries', col_error: 'Last error',
  replay: 'Replay', discard: 'Discard',
  summaries: 'Closed totals', kind_shift: 'By shift', kind_hour: 'By hour', exportCsv: 'Export CSV', noSummaries: 'No closed periods yet. A shift or hour closes one hour after it ends.',
  sc_machine: 'Machine', sc_period: 'Period', sc_ver: 'Version', sc_total: 'Total', sc_good: 'Good', sc_scrap: 'Scrap', sc_run: 'Run (s)', sc_stop: 'Stop (s)', sc_cov: 'Data coverage',
  origin: 'Site data is', origin_production: 'Production', origin_demo: 'Demo', origin_simulated: 'Simulated', origin_test: 'Test',
  originNote: 'Only production sites send to an ERP or appear in exports. A changed total is a new version, never an edit of a closed one.',
};
const th = {
  title: 'การเชื่อมต่อระบบ', lede: 'สิ่งที่ส่งไป ERP หรือ webhook อะไรล้มเหลว และยอดกะกับยอดรายชั่วโมงที่ปิดแล้วเบื้องหลัง',
  outbox: 'การส่งข้อมูล', filter: 'สถานะ', all: 'ทั้งหมด', st_pending: 'รอส่ง', st_sent: 'ส่งแล้ว', st_dead: 'ล้มเหลวถาวร',
  noOutbox: 'ยังไม่มีรายการ รายการจะขึ้นหลังกะหรือชั่วโมงปิดและมี webhook สมัครรับไว้',
  col_when: 'เข้าคิว', col_event: 'เหตุการณ์', col_status: 'สถานะ', col_attempts: 'ครั้งที่ลอง', col_error: 'ข้อผิดพลาดล่าสุด',
  replay: 'ส่งใหม่', discard: 'ทิ้ง',
  summaries: 'ยอดที่ปิดแล้ว', kind_shift: 'รายกะ', kind_hour: 'รายชั่วโมง', exportCsv: 'ส่งออก CSV', noSummaries: 'ยังไม่มีช่วงที่ปิด กะหรือชั่วโมงจะปิดหลังจบไปหนึ่งชั่วโมง',
  sc_machine: 'เครื่อง', sc_period: 'ช่วงเวลา', sc_ver: 'เวอร์ชัน', sc_total: 'รวม', sc_good: 'ของดี', sc_scrap: 'ของเสีย', sc_run: 'เดิน (วิ)', sc_stop: 'หยุด (วิ)', sc_cov: 'ข้อมูลครบ',
  origin: 'ข้อมูลของไซต์คือ', origin_production: 'งานจริง', origin_demo: 'เดโม', origin_simulated: 'จำลอง', origin_test: 'ทดสอบ',
  originNote: 'เฉพาะไซต์งานจริงเท่านั้นที่ส่งไป ERP และอยู่ในไฟล์ส่งออก ยอดที่เปลี่ยนจะเป็นเวอร์ชันใหม่ ไม่แก้ของเดิมที่ปิดแล้ว',
};

i18n.addResourceBundle('en', 'translation', { int: en }, true, true);
i18n.addResourceBundle('th', 'translation', { int: th }, true, true);
