// Copy for the ERP import page. Namespaced `erp`.

import i18n from '../../../lib/i18n';

const en = {
  title: 'ERP import', lede: 'Bring products, work centers and work orders in from Odoo (read-only) or a CSV file. Always preview first.',
  import: 'Import', entity: 'What to import', file: 'CSV file', preview: 'Preview CSV', apply: 'Apply CSV',
  previewOdoo: 'Preview {{name}}', syncOdoo: 'Sync {{name}}', e_product: 'Products', e_work_center: 'Work centers', e_work_order: 'Work orders',
  csvHelp: 'Columns: products need code, name; work centers need code, name; work orders need code, product_code, qty_planned, due_at, status, work_center. The ERP wins for these fields. Nothing is ever written back to the ERP.',
  wouldDo: 'Would do', did: 'Done', counts: '{{added}} new, {{updated}} changed, {{skipped}} unchanged, {{bad}} rejected, {{staged}} waiting for a machine',
  staging: 'Work centers waiting for a machine', noStaging: 'Nothing waiting. Unmapped work centers appear here after a sync.',
  connTitle: 'ERP connection', connName: 'Connection name', odooUrl: 'Odoo URL', odooDb: 'Database', odooUser: 'User', secret: 'API key or password', connSave: 'Add connection', connSaved: 'Connection added.',
  secretSet: 'secret stored', secretNone: 'no secret', secretHelp: 'The secret is write-only. It is stored encrypted and never shown again. To change it, add the connection again.', needAdmin: 'Only an admin or owner can change ERP settings.',
  mapTitle: 'ID mapping', mapConn: 'Connection', pickConn: 'Choose a connection', extId: 'ERP id', localId: 'Local id', extVer: 'ERP version', mapSave: 'Save mapping', mapSaved: 'Mapping saved.', noMap: 'No mappings yet.', edit: 'Edit', errGeneric: 'Could not save: {{reason}}',
  e_reason: 'Reasons',
  pickMachine: 'Choose a machine', map: 'Map', runs: 'Recent runs', noRuns: 'No runs yet', dry: 'preview',
};
const th = {
  title: 'นำเข้าจาก ERP', lede: 'นำสินค้า work center และใบสั่งผลิตเข้าจาก Odoo (อ่านอย่างเดียว) หรือไฟล์ CSV ดูตัวอย่างก่อนเสมอ',
  import: 'นำเข้า', entity: 'นำเข้าอะไร', file: 'ไฟล์ CSV', preview: 'ดูตัวอย่าง CSV', apply: 'นำเข้า CSV',
  previewOdoo: 'ดูตัวอย่าง {{name}}', syncOdoo: 'ซิงก์ {{name}}', e_product: 'สินค้า', e_work_center: 'Work center', e_work_order: 'ใบสั่งผลิต',
  csvHelp: 'คอลัมน์: สินค้าใช้ code, name; work center ใช้ code, name; ใบสั่งผลิตใช้ code, product_code, qty_planned, due_at, status, work_center ฟิลด์เหล่านี้ใช้ค่าจาก ERP เป็นหลัก และระบบไม่เขียนอะไรกลับไป ERP',
  wouldDo: 'จะทำ', did: 'ทำแล้ว', counts: 'ใหม่ {{added}} เปลี่ยน {{updated}} เหมือนเดิม {{skipped}} ปฏิเสธ {{bad}} รอเลือกเครื่อง {{staged}}',
  staging: 'Work center ที่รอเลือกเครื่อง', noStaging: 'ไม่มีรายการรอ work center ที่ยังไม่จับคู่จะขึ้นที่นี่หลังซิงก์',
  connTitle: 'การเชื่อมต่อ ERP', connName: 'ชื่อการเชื่อมต่อ', odooUrl: 'URL ของ Odoo', odooDb: 'ฐานข้อมูล', odooUser: 'ผู้ใช้', secret: 'API key หรือรหัสผ่าน', connSave: 'เพิ่มการเชื่อมต่อ', connSaved: 'เพิ่มการเชื่อมต่อแล้ว',
  secretSet: 'เก็บรหัสลับแล้ว', secretNone: 'ไม่มีรหัสลับ', secretHelp: 'รหัสลับเขียนได้อย่างเดียว เก็บแบบเข้ารหัสและไม่แสดงอีก หากต้องการเปลี่ยนให้เพิ่มการเชื่อมต่อใหม่', needAdmin: 'เฉพาะผู้ดูแลหรือเจ้าของที่แก้ค่า ERP ได้',
  mapTitle: 'การจับคู่รหัส', mapConn: 'การเชื่อมต่อ', pickConn: 'เลือกการเชื่อมต่อ', extId: 'รหัสใน ERP', localId: 'รหัสในระบบ', extVer: 'เวอร์ชันใน ERP', mapSave: 'บันทึกการจับคู่', mapSaved: 'บันทึกการจับคู่แล้ว', noMap: 'ยังไม่มีการจับคู่', edit: 'แก้ไข', errGeneric: 'บันทึกไม่สำเร็จ: {{reason}}',
  e_reason: 'เหตุผล',
  pickMachine: 'เลือกเครื่อง', map: 'จับคู่', runs: 'การทำงานล่าสุด', noRuns: 'ยังไม่มี', dry: 'ตัวอย่าง',
};

i18n.addResourceBundle('en', 'translation', { erp: en }, true, true);
i18n.addResourceBundle('th', 'translation', { erp: th }, true, true);
