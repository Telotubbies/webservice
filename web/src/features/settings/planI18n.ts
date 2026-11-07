// Copy for the plan comparison page. Namespaced `plc`.

import i18n from '../../lib/i18n';

const en = {
  title: 'Compare plans', lede: 'The real limits of every plan, next to what your organisation uses today.',
  limit: 'Limit', yours: 'Your usage', current: 'current', unlimited: 'Unlimited', yes: 'Yes', no: 'No',
  max_sites: 'Sites', max_edges: 'Gateways', max_tags: 'Tags', max_users: 'Users', max_cameras: 'Cameras',
  max_vision_models: 'Vision models', retention_days: 'History kept (days)', gpu_hours_monthly: 'Cloud GPU hours per month',
  api_rate_per_min: 'API requests per minute', sso: 'Single sign-on', audit_export: 'Audit export', sms: 'SMS alerts', assistant: 'Assistant',
  note: 'Plans are changed by the platform team. Write to your account contact to move up.',
};
const th = {
  title: 'เทียบแพลน', lede: 'ขีดจำกัดจริงของทุกแพลน เทียบกับที่องค์กรของคุณใช้อยู่ตอนนี้',
  limit: 'ขีดจำกัด', yours: 'ที่คุณใช้', current: 'ปัจจุบัน', unlimited: 'ไม่จำกัด', yes: 'มี', no: 'ไม่มี',
  max_sites: 'ไซต์', max_edges: 'เกตเวย์', max_tags: 'แท็ก', max_users: 'ผู้ใช้', max_cameras: 'กล้อง',
  max_vision_models: 'โมเดล Vision', retention_days: 'เก็บประวัติ (วัน)', gpu_hours_monthly: 'ชั่วโมง GPU บนคลาวด์ต่อเดือน',
  api_rate_per_min: 'คำขอ API ต่อนาที', sso: 'ลงชื่อเข้าใช้ครั้งเดียว', audit_export: 'ส่งออกบันทึกตรวจสอบ', sms: 'แจ้งเตือน SMS', assistant: 'ผู้ช่วย',
  note: 'ทีมแพลตฟอร์มเป็นผู้เปลี่ยนแพลน ติดต่อผู้ดูแลบัญชีของคุณเพื่ออัปเกรด',
};

i18n.addResourceBundle('en', 'translation', { plc: en }, true, true);
i18n.addResourceBundle('th', 'translation', { plc: th }, true, true);
