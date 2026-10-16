// Monitors list (alarm rules + live state). Namespace `mon`.
import i18n from '../../lib/i18n';

i18n.addResourceBundle('en', 'translation', { mon: {
  title: 'Monitors', list: 'List', triggered: 'Triggered', downtimes: 'Downtimes', quality: 'Quality',
  filters: 'Filters', settings: 'Settings', newRule: 'New rule', search: 'Search rules by name, signal or equipment',
  searchLabel: 'Search monitors', showing: 'Showing {{shown}} of {{total}} rules',
  empty: 'No rules match', emptyBody: 'Clear a filter or search for something else.',
  noRules: 'No alarm rules yet', noRulesBody: 'Create a rule to start watching a signal.',
  colStatus: 'Status', colName: 'Name', colCondition: 'Condition', colSeverity: 'Priority', colArea: 'Equipment',
  fStatus: 'Status', fSeverity: 'Priority', fMuted: 'Muted', fKind: 'Rule type', fArea: 'Equipment', fSignal: 'Signal',
  fTriggered: 'Triggered', viewMore: 'View more values', clear: 'Clear filters',
  alert: 'Alert', warn: 'Warn', nodata: 'No data', ok: 'OK', disabled: 'Disabled',
  muted: 'Muted', notMuted: 'Not muted', mutedHint: 'An open alarm from this rule is shelved',
  openAlarms: '{{count}} open', otherArea: 'Other',
  kind: { hi: 'High', hihi: 'High-high', lo: 'Low', lolo: 'Low-low', stale: 'Stale', roc: 'Rate of change', anomaly: 'Anomaly', forecast: 'Forecast' },
  cond: { gt: '> {{v}}', lt: '< {{v}}', stale: 'silent > {{v}} s', roc: 'rate > {{v}}', none: 'learned' },
  docs: 'Alarm rules',
} });

i18n.addResourceBundle('th', 'translation', { mon: {
  title: 'มอนิเตอร์', list: 'รายการ', triggered: 'ที่ทริกเกอร์', downtimes: 'ช่วงปิดเตือน', quality: 'คุณภาพ',
  filters: 'ตัวกรอง', settings: 'ตั้งค่า', newRule: 'สร้างกฎใหม่', search: 'ค้นหากฎตามชื่อ สัญญาณ หรืออุปกรณ์',
  searchLabel: 'ค้นหามอนิเตอร์', showing: 'แสดง {{shown}} จาก {{total}} กฎ',
  empty: 'ไม่พบกฎที่ตรงกัน', emptyBody: 'ล้างตัวกรองหรือค้นหาคำอื่น',
  noRules: 'ยังไม่มีกฎแจ้งเตือน', noRulesBody: 'สร้างกฎเพื่อเริ่มเฝ้าดูสัญญาณ',
  colStatus: 'สถานะ', colName: 'ชื่อ', colCondition: 'เงื่อนไข', colSeverity: 'ลำดับความสำคัญ', colArea: 'อุปกรณ์',
  fStatus: 'สถานะ', fSeverity: 'ลำดับความสำคัญ', fMuted: 'ปิดเสียง', fKind: 'ชนิดกฎ', fArea: 'อุปกรณ์', fSignal: 'สัญญาณ',
  fTriggered: 'ที่ทริกเกอร์', viewMore: 'ดูค่าเพิ่มเติม', clear: 'ล้างตัวกรอง',
  alert: 'วิกฤต', warn: 'เตือน', nodata: 'ไม่มีข้อมูล', ok: 'ปกติ', disabled: 'ปิดใช้งาน',
  muted: 'ปิดเสียง', notMuted: 'ไม่ปิดเสียง', mutedHint: 'แอลาร์มที่เปิดอยู่ของกฎนี้ถูกพักไว้',
  openAlarms: 'เปิดอยู่ {{count}}', otherArea: 'อื่น ๆ',
  kind: { hi: 'สูง', hihi: 'สูงมาก', lo: 'ต่ำ', lolo: 'ต่ำมาก', stale: 'ขาดสัญญาณ', roc: 'อัตราเปลี่ยน', anomaly: 'ผิดปกติ', forecast: 'พยากรณ์' },
  cond: { gt: '> {{v}}', lt: '< {{v}}', stale: 'เงียบ > {{v}} วินาที', roc: 'อัตรา > {{v}}', none: 'เรียนรู้เอง' },
  docs: 'กฎแจ้งเตือน',
} });
