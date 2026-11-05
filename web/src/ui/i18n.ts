// Strings for the Console 5 primitives (web/src/ui). Namespaced `kit.*`
// because `ui.*` already belongs to the legacy shared/ui strings.

import i18n from '../lib/i18n';

i18n.addResourceBundle('en', 'translation', {
  kit: {
    loading: 'Working…',
    close: 'Close',
    dismiss: 'Dismiss',
    notifications: 'Notifications',
    decrease: 'Decrease',
    increase: 'Increase',
    noMatches: 'No matches',
    numEmpty: 'Enter a number',
    numNan: 'That is not a number',
    numMin: 'At least {{min}}',
    numMax: 'At most {{max}}',
    sim: 'SIM',
  },
}, true, true);

i18n.addResourceBundle('th', 'translation', {
  kit: {
    loading: 'กำลังดำเนินการ…',
    close: 'ปิด',
    dismiss: 'ปิดข้อความ',
    notifications: 'การแจ้งเตือน',
    decrease: 'ลดค่า',
    increase: 'เพิ่มค่า',
    noMatches: 'ไม่พบรายการ',
    numEmpty: 'กรอกตัวเลข',
    numNan: 'ค่านี้ไม่ใช่ตัวเลข',
    numMin: 'อย่างน้อย {{min}}',
    numMax: 'ไม่เกิน {{max}}',
    sim: 'จำลอง',
  },
}, true, true);
