// User-guide page chrome (manual.*; guide.* is the onboarding connect guide).
// The guide text itself lives in content.ts, one array per language.

import i18n from '../../lib/i18n';

i18n.addResourceBundle('en', 'translation', { manual: {
  title: 'User guide',
  lede: 'How to run a shift, set up the plant and manage people — step by step, with links to each page.',
  contents: 'Guide contents', showFor: 'Show steps for', all: 'Everyone', everyone: 'Everyone',
  role: { operator: 'Operator', engineer: 'Engineer', admin: 'Admin' },
  part: { start: 'Getting started', operator: 'Operating', engineer: 'Engineering', admin: 'Administration', reference: 'Reference' },
  note: 'Note:',
  legendPriority: 'Alarm priority', legendLifecycle: 'Alarm state', legendEquipment: 'Equipment', legendData: 'Data quality',
  footer: 'Something missing or unclear? Tell your administrator — the guide is updated with the console.',
  open: 'User guide',
} }, true, true);

i18n.addResourceBundle('th', 'translation', { manual: {
  title: 'คู่มือการใช้งาน',
  lede: 'วิธีทำงานในกะ ตั้งค่าโรงงาน และจัดการผู้ใช้ ทีละขั้นตอน พร้อมลิงก์ไปยังหน้าที่เกี่ยวข้อง',
  contents: 'สารบัญคู่มือ', showFor: 'แสดงขั้นตอนสำหรับ', all: 'ทุกคน', everyone: 'ทุกคน',
  role: { operator: 'ผู้ควบคุม', engineer: 'วิศวกร', admin: 'ผู้ดูแล' },
  part: { start: 'เริ่มต้น', operator: 'งานควบคุม', engineer: 'งานวิศวกรรม', admin: 'งานผู้ดูแลระบบ', reference: 'ข้อมูลอ้างอิง' },
  note: 'หมายเหตุ:',
  legendPriority: 'ลำดับความสำคัญ', legendLifecycle: 'สถานะสัญญาณเตือน', legendEquipment: 'เครื่องจักร', legendData: 'คุณภาพข้อมูล',
  footer: 'มีส่วนที่ขาดหรือไม่ชัดเจน? แจ้งผู้ดูแลระบบ คู่มือจะปรับปรุงไปพร้อมกับคอนโซล',
  open: 'คู่มือการใช้งาน',
} }, true, true);
