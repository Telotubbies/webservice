// Copy for the smaller console pages (Logs, Catalog, Query, Security,
// Sessions, Synthetics, Traces, Processes, Alarm settings). Namespaced `px`.

import i18n from '../../lib/i18n';

i18n.addResourceBundle('en', 'translation', { px: {
  search: 'Filter', showing: 'Showing {{shown}} of {{total}}', empty: 'Nothing matches.', failed: 'Could not load this page.',
  needAdmin: 'Admin role required.', needOperator: 'Operator role required.', yes: 'Yes', no: 'No', export: 'Export CSV',
  logs: { title: 'Logs', queryPh: 'Filter log lines', colTime: 'Time', colLevel: 'Level', colSource: 'Source', colMsg: 'Message', none: 'info' },
  processes: { title: 'Edge processes', mqtt: 'Broker', db: 'Database' },
  catalog: { title: 'Asset catalog', queryPh: 'Filter by signal, equipment or unit', facetEquipment: 'Equipment', other: 'Other',
    colSignal: 'Signal', colEquipment: 'Equipment', colUnit: 'Unit', colWritable: 'Writable', colQuality: 'Quality', colAge: 'Last value' },
  alarmSettings: { title: 'Alarm settings', manage: 'Manage rules', total: 'Rules', enabled: 'Enabled', disabled: 'Disabled',
    bySeverity: 'By severity', colRule: 'Rule', colTag: 'Signal', colKind: 'Kind', colThreshold: 'Threshold', colSeverity: 'Severity', colState: 'State' },
  query: { title: 'Query', metric: 'Signal', range: 'Range', pick: 'Choose a signal', count: 'Samples', min: 'Min', max: 'Max', avg: 'Average', last: 'Last', noData: 'No samples in this range.' },
  security: { title: 'Security signals', rotation: 'Credentials due for rotation', noRotation: 'No edge credential needs rotation.',
    audit: 'Recent security events', noAudit: 'No security events recorded.', colWhen: 'When', colActor: 'Actor', colAction: 'Action' },
  sessions: { title: 'Sessions', user: 'Signed in as', role: 'Role', kind: 'Sign-in', orgs: 'Organizations', colOrg: 'Organization', colRole: 'Role', signOut: 'Sign out', oidc: 'Single sign-on', dev: 'Dev token' },
  synthetics: { title: 'Heartbeat checks', colCheck: 'Check', colStatus: 'Status', colAge: 'Last value', ok: 'Passing', stale: 'Stale', bad: 'Bad quality', none: 'No data', edges: 'Edge heartbeats' },
  traces: { title: 'Command traces', colId: 'Command', colStatus: 'Status', colIssued: 'Issued', colActor: 'By', from: 'From', to: 'To', events: 'Transitions' },
} });

i18n.addResourceBundle('th', 'translation', { px: {
  search: 'กรอง', showing: 'แสดง {{shown}} จาก {{total}}', empty: 'ไม่พบรายการที่ตรงกัน', failed: 'โหลดหน้านี้ไม่สำเร็จ',
  needAdmin: 'ต้องมีบทบาทผู้ดูแล', needOperator: 'ต้องมีบทบาทผู้ปฏิบัติการ', yes: 'ใช่', no: 'ไม่', export: 'ส่งออก CSV',
  logs: { title: 'บันทึกเหตุการณ์', queryPh: 'กรองบรรทัดบันทึก', colTime: 'เวลา', colLevel: 'ระดับ', colSource: 'แหล่งที่มา', colMsg: 'ข้อความ', none: 'ข้อมูล' },
  processes: { title: 'โปรเซสที่ edge', mqtt: 'โบรกเกอร์', db: 'ฐานข้อมูล' },
  catalog: { title: 'แคตตาล็อกอุปกรณ์', queryPh: 'กรองตามสัญญาณ อุปกรณ์ หรือหน่วย', facetEquipment: 'อุปกรณ์', other: 'อื่น ๆ',
    colSignal: 'สัญญาณ', colEquipment: 'อุปกรณ์', colUnit: 'หน่วย', colWritable: 'เขียนได้', colQuality: 'คุณภาพ', colAge: 'ค่าล่าสุด' },
  alarmSettings: { title: 'ตั้งค่าการเตือน', manage: 'จัดการกฎ', total: 'กฎทั้งหมด', enabled: 'เปิดใช้', disabled: 'ปิดใช้',
    bySeverity: 'ตามความรุนแรง', colRule: 'กฎ', colTag: 'สัญญาณ', colKind: 'ชนิด', colThreshold: 'ค่าเกณฑ์', colSeverity: 'ความรุนแรง', colState: 'สถานะ' },
  query: { title: 'สืบค้น', metric: 'สัญญาณ', range: 'ช่วงเวลา', pick: 'เลือกสัญญาณ', count: 'จำนวนตัวอย่าง', min: 'ต่ำสุด', max: 'สูงสุด', avg: 'เฉลี่ย', last: 'ล่าสุด', noData: 'ไม่มีตัวอย่างในช่วงนี้' },
  security: { title: 'สัญญาณความปลอดภัย', rotation: 'รหัสผ่านที่ถึงเวลาหมุนเวียน', noRotation: 'ไม่มี edge ที่ต้องหมุนเวียนรหัสผ่าน',
    audit: 'เหตุการณ์ความปลอดภัยล่าสุด', noAudit: 'ยังไม่มีเหตุการณ์ความปลอดภัย', colWhen: 'เมื่อ', colActor: 'ผู้ทำ', colAction: 'การกระทำ' },
  sessions: { title: 'เซสชัน', user: 'เข้าสู่ระบบในชื่อ', role: 'บทบาท', kind: 'วิธีเข้าสู่ระบบ', orgs: 'องค์กร', colOrg: 'องค์กร', colRole: 'บทบาท', signOut: 'ออกจากระบบ', oidc: 'Single sign-on', dev: 'โทเคนสำหรับพัฒนา' },
  synthetics: { title: 'การตรวจชีพจร', colCheck: 'รายการตรวจ', colStatus: 'สถานะ', colAge: 'ค่าล่าสุด', ok: 'ผ่าน', stale: 'ค่าเก่า', bad: 'คุณภาพไม่ดี', none: 'ไม่มีข้อมูล', edges: 'ชีพจรของ edge' },
  traces: { title: 'ร่องรอยคำสั่ง', colId: 'คำสั่ง', colStatus: 'สถานะ', colIssued: 'สั่งเมื่อ', colActor: 'โดย', from: 'จาก', to: 'เป็น', events: 'การเปลี่ยนสถานะ' },
} });
