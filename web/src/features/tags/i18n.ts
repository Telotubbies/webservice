// Copy for the rule section of the tag flyout. Namespaced `rl`; registered on import.

import i18n from '../../lib/i18n';

const en = {
  title: 'Alarm rule', add: 'Add alarm rule', kind: 'Kind', threshold: 'Threshold', staleS: 'Silent for (s)', deadband: 'Deadband',
  severity: 'Severity', name: 'Rule name', hours: 'Test on the last',
  hoursOpt: '{{h}} h', kind_hi: 'High', kind_hihi: 'High high', kind_lo: 'Low', kind_lolo: 'Low low', kind_stale: 'No data',
  sev_info: 'Info', sev_warning: 'Warning', sev_critical: 'Critical',
  test: 'Test on history', testing: 'Testing...',
  result: 'Would have fired {{count}} times in the last {{hours}} h ({{samples}} samples).',
  resultNone: 'Would not have fired in the last {{hours}} h ({{samples}} samples).',
  resultTruncated: 'Only the first part of the history was checked.',
  resultLast: 'Most recent: {{when}}',
  untestable: 'This kind cannot be tested on history yet.',
  testFirst: 'Test the rule first to see how often it would fire.',
  cancel: 'Cancel', save: 'Save rule', saving: 'Saving...', saved: 'Rule saved.',
  criticalNote: 'Critical rules stay off until a second person approves them.',
  savedPending: 'Saved. The rule is off until a second person approves it.',
  stApproved: 'Approved', pending: 'Waiting for approval', pendingMine: 'You proposed this rule. Another person must approve it.',
  approve: 'Approve', reject: 'Reject', approved: 'Rule approved and switched on.', rejected: 'Rule rejected.',
  needAdmin: 'Admin or owner role required to change rules.',
  errAuthor: 'You cannot approve a rule you wrote.', errExists: 'A rule with this name already exists on this tag.',
  errGeneric: 'Request failed: {{reason}}', needThreshold: 'Enter a threshold.', needStale: 'Enter 5 to 86400 seconds.', needName: 'Enter a rule name.',
};

const th: typeof en = {
  title: 'กฎแจ้งเตือน', add: 'เพิ่มกฎแจ้งเตือน', kind: 'ชนิด', threshold: 'ค่าเกณฑ์', staleS: 'ไม่มีข้อมูลนาน (วินาที)', deadband: 'เดดแบนด์',
  severity: 'ระดับ', name: 'ชื่อกฎ', hours: 'ทดสอบย้อนหลัง',
  hoursOpt: '{{h}} ชม.', kind_hi: 'สูง', kind_hihi: 'สูงมาก', kind_lo: 'ต่ำ', kind_lolo: 'ต่ำมาก', kind_stale: 'ไม่มีข้อมูล',
  sev_info: 'ข้อมูล', sev_warning: 'เตือน', sev_critical: 'วิกฤต',
  test: 'ทดสอบกับข้อมูลย้อนหลัง', testing: 'กำลังทดสอบ...',
  result: 'กฎนี้จะเตือน {{count}} ครั้งใน {{hours}} ชม. ที่ผ่านมา (จาก {{samples}} ค่า)',
  resultNone: 'กฎนี้จะไม่เตือนเลยใน {{hours}} ชม. ที่ผ่านมา (จาก {{samples}} ค่า)',
  resultTruncated: 'ตรวจเฉพาะข้อมูลช่วงแรกของประวัติ',
  resultLast: 'ล่าสุด: {{when}}',
  untestable: 'กฎชนิดนี้ยังทดสอบกับข้อมูลย้อนหลังไม่ได้',
  testFirst: 'ทดสอบกฎก่อนเพื่อดูว่าจะเตือนบ่อยแค่ไหน',
  cancel: 'ยกเลิก', save: 'บันทึกกฎ', saving: 'กำลังบันทึก...', saved: 'บันทึกกฎแล้ว',
  criticalNote: 'กฎระดับวิกฤตจะปิดอยู่จนกว่าคนที่สองจะอนุมัติ',
  savedPending: 'บันทึกแล้ว กฎจะปิดอยู่จนกว่าคนที่สองจะอนุมัติ',
  stApproved: 'อนุมัติแล้ว', pending: 'รออนุมัติ', pendingMine: 'คุณเป็นผู้เสนอกฎนี้ ต้องให้คนอื่นอนุมัติ',
  approve: 'อนุมัติ', reject: 'ไม่อนุมัติ', approved: 'อนุมัติแล้ว กฎเริ่มทำงาน', rejected: 'ไม่อนุมัติกฎนี้แล้ว',
  needAdmin: 'ต้องเป็นผู้ดูแลหรือเจ้าของจึงจะแก้กฎได้',
  errAuthor: 'คุณอนุมัติกฎที่ตัวเองเขียนไม่ได้', errExists: 'แท็กนี้มีกฎชื่อนี้อยู่แล้ว',
  errGeneric: 'คำขอล้มเหลว: {{reason}}', needThreshold: 'ใส่ค่าเกณฑ์', needStale: 'ใส่ 5 ถึง 86400 วินาที', needName: 'ใส่ชื่อกฎ',
};

i18n.addResourceBundle('en', 'translation', { rl: en }, true, true);
i18n.addResourceBundle('th', 'translation', { rl: th }, true, true);
