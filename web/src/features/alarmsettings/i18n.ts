// Alarm-settings subsection strings (aset.*) — General keeps the existing
// px.alarmSettings.* keys from features/misc/i18n; this file covers the new
// Notifications / Policies / Archive sections.

import i18n from '../../lib/i18n';

i18n.addResourceBundle('en', 'translation', { aset: {
  tabGeneral: 'General', tabNotifications: 'Notifications', tabPolicies: 'Policies', tabArchive: 'Archive',
  notif: {
    title: 'Notification channels',
    lede: 'Where alarm notifications are delivered. Channels and routing are managed on the notification pages.',
    colName: 'Channel', colType: 'Type', colState: 'State', colCreated: 'Added',
    policies: 'Escalation policies', policiesLede: 'If an alarm stays unacknowledged, the next level is notified.',
    colPolicy: 'Policy', colScope: 'Scope', colLevels: 'Levels', scopeAll: 'All rules',
    levelAfter: 'after {{n}} min', oncall: 'on-call',
    manage: 'Manage channels & policies',
    empty: 'No notification channels yet', emptyBody: 'Add a channel so alarms can reach the shift.',
    adminNote: 'Only admins can change notification settings.',
  },
  pol: {
    downtimes: 'Downtime policies', downtimesLede: 'Maintenance windows that mute matching rules.',
    shelving: 'Alarm shelving',
    shelvingBody: 'Operators shelve an alarm for 1 hour to 7 days from the alarm page; it re-opens automatically when the shelf expires.',
    colScope: 'Scope', colDesc: 'Description', colWindow: 'Window', colRecur: 'Recurring', colEnds: 'Ends',
    scopeAll: 'All rules', recurring: 'Repeats', once: 'Once',
    active: 'Active', scheduled: 'Scheduled', past: 'Ended',
    manage: 'Manage downtimes',
    empty: 'No downtime policies', emptyBody: 'Schedule a maintenance window to mute rules during planned work.',
  },
  arc: {
    title: 'Disabled rules', lede: 'Rules that were switched off. Restoring re-enables evaluation immediately.',
    restore: 'Restore', restoring: 'Restoring…', restored: 'Restored',
    empty: 'No disabled rules', emptyBody: 'Rules you disable land here instead of disappearing.',
    adminOnly: 'Only admins can restore a rule.',
    failed: 'Restore failed: {{reason}}',
  },
} }, true);

i18n.addResourceBundle('th', 'translation', { aset: {
  tabGeneral: 'ทั่วไป', tabNotifications: 'การแจ้งเตือน', tabPolicies: 'นโยบาย', tabArchive: 'ที่เก็บ',
  notif: {
    title: 'ช่องทางการแจ้งเตือน',
    lede: 'ปลายทางที่การแจ้งเตือนแอลาร์มถูกส่งไป จัดการช่องทางและการกำหนดเส้นทางได้ที่หน้าการแจ้งเตือน',
    colName: 'ช่องทาง', colType: 'ชนิด', colState: 'สถานะ', colCreated: 'เพิ่มเมื่อ',
    policies: 'นโยบายการเลื่อนระดับ', policiesLede: 'หากแอลาร์มยังไม่ถูกรับทราบ ระดับถัดไปจะถูกแจ้ง',
    colPolicy: 'นโยบาย', colScope: 'ขอบเขต', colLevels: 'ระดับ', scopeAll: 'ทุกกฎ',
    levelAfter: 'หลัง {{n}} นาที', oncall: 'ผู้เวร',
    manage: 'จัดการช่องทางและนโยบาย',
    empty: 'ยังไม่มีช่องทางการแจ้งเตือน', emptyBody: 'เพิ่มช่องทางเพื่อให้แอลาร์มถึงมือผู้เวร',
    adminNote: 'เฉพาะผู้ดูแลเท่านั้นที่เปลี่ยนการตั้งค่าการแจ้งเตือนได้',
  },
  pol: {
    downtimes: 'นโยบายช่วงหยุด', downtimesLede: 'ช่วงบำรุงรักษาที่ทำให้กฎที่ตรงกันเงียบลง',
    shelving: 'การพักแอลาร์ม',
    shelvingBody: 'ผู้ปฏิบัติงานพักแอลาร์มได้ 1 ชั่วโมงถึง 7 วันจากหน้าแอลาร์ม ระบบจะเปิดแอลาร์มอีกครั้งเมื่อครบกำหนด',
    colScope: 'ขอบเขต', colDesc: 'คำอธิบาย', colWindow: 'ช่วงเวลา', colRecur: 'ทำซ้ำ', colEnds: 'สิ้นสุด',
    scopeAll: 'ทุกกฎ', recurring: 'ทำซ้ำ', once: 'ครั้งเดียว',
    active: 'กำลังใช้งาน', scheduled: 'ตั้งเวลาไว้', past: 'สิ้นสุดแล้ว',
    manage: 'จัดการช่วงหยุด',
    empty: 'ไม่มีนโยบายช่วงหยุด', emptyBody: 'ตั้งเวลาบำรุงรักษาเพื่อให้กฎเงียบในงานตามแผน',
  },
  arc: {
    title: 'กฎที่ปิดใช้งาน', lede: 'กฎที่ถูกปิดไว้ การกู้คืนจะเปิดการประเมินใหม่ทันที',
    restore: 'กู้คืน', restoring: 'กำลังกู้คืน…', restored: 'กู้คืนแล้ว',
    empty: 'ไม่มีกฎที่ปิดใช้งาน', emptyBody: 'กฎที่คุณปิดจะมาอยู่ที่นี่แทนที่จะหายไป',
    adminOnly: 'เฉพาะผู้ดูแลเท่านั้นที่กู้คืนกฎได้',
    failed: 'กู้คืนไม่สำเร็จ: {{reason}}',
  },
} }, true);
