// Copy for the Storage page. Namespaced `sto`.

import i18n from '../../lib/i18n';

const en = {
  title: 'Storage', lede: 'Uploads per user and their durable copy in Garage.', sync: 'Copy missing to Garage',
  scopeOrg: 'You see the whole organization because you are an admin. Members only see their own uploads.',
  scopeMine: 'You see only the files you uploaded. Admins see the whole organization.',
  objects: 'Objects', size: 'Size', inGarage: 'Stored in Garage', missing: 'Not yet in Garage', missingHint: 'An admin can copy them',
  garageOff: 'Garage is not configured', garageOk: 'Bucket {{bucket}} reachable', garageDown: 'Garage unreachable',
  byKind: 'By type', byUser: 'By user', byYou: 'Your uploads', items: 'Files', none: 'Nothing uploaded yet',
  name: 'Name', type: 'Type', owner: 'Uploaded by', when: 'When', stored: 'Stored', notStored: 'Not stored',
  kind_video: 'Video', kind_model: 'Model', kind_plant: '3D plant model', synced: 'Copied {{n}} file(s) to Garage.',
  orphans: 'Objects without a record', orphansHint: 'These exist in this organization\'s Garage folder but no database row points to them. They are never served; review and remove them in Garage.',
  isoTitle: 'How files are kept apart',
  isoBody: 'Every object key is built by the server from the organization id and a random id, never from a file name. A file can only be read through a database row of its own organization, and each listing here is limited to this organization\'s folder in Garage.',
};
const th = {
  title: 'พื้นที่จัดเก็บ', lede: 'ไฟล์ที่อัปโหลดแยกตามผู้ใช้ และสำเนาถาวรใน Garage', sync: 'คัดลอกที่ยังไม่มีไป Garage',
  scopeOrg: 'คุณเห็นทั้งองค์กรเพราะเป็นผู้ดูแล สมาชิกทั่วไปเห็นเฉพาะไฟล์ที่ตนอัปโหลด',
  scopeMine: 'คุณเห็นเฉพาะไฟล์ที่คุณอัปโหลด ผู้ดูแลเห็นทั้งองค์กร',
  objects: 'จำนวนไฟล์', size: 'ขนาด', inGarage: 'เก็บใน Garage แล้ว', missing: 'ยังไม่อยู่ใน Garage', missingHint: 'ผู้ดูแลสั่งคัดลอกได้',
  garageOff: 'ยังไม่ได้ตั้งค่า Garage', garageOk: 'เข้าถึง bucket {{bucket}} ได้', garageDown: 'เข้าถึง Garage ไม่ได้',
  byKind: 'ตามชนิด', byUser: 'ตามผู้ใช้', byYou: 'ไฟล์ของคุณ', items: 'ไฟล์', none: 'ยังไม่มีไฟล์ที่อัปโหลด',
  name: 'ชื่อ', type: 'ชนิด', owner: 'อัปโหลดโดย', when: 'เมื่อ', stored: 'เก็บแล้ว', notStored: 'ยังไม่เก็บ',
  kind_video: 'วิดีโอ', kind_model: 'โมเดล', kind_plant: 'โมเดล 3D โรงงาน', synced: 'คัดลอก {{n}} ไฟล์ไป Garage แล้ว',
  orphans: 'ไฟล์ที่ไม่มีระเบียน', orphansHint: 'ไฟล์เหล่านี้อยู่ในโฟลเดอร์ Garage ขององค์กรนี้ แต่ไม่มีแถวในฐานข้อมูลอ้างถึง ระบบจะไม่ส่งให้ใคร ตรวจแล้วลบใน Garage ได้',
  isoTitle: 'การแยกไฟล์ของแต่ละคน',
  isoBody: 'คีย์ของทุกไฟล์ถูกสร้างโดยเซิร์ฟเวอร์จากรหัสองค์กรและรหัสสุ่ม ไม่ใช้ชื่อไฟล์ ไฟล์อ่านได้ผ่านแถวในฐานข้อมูลขององค์กรตัวเองเท่านั้น และรายการที่แสดงจำกัดอยู่ในโฟลเดอร์ขององค์กรนี้ใน Garage',
};
i18n.addResourceBundle('en', 'translation', { sto: en }, true, true);
i18n.addResourceBundle('th', 'translation', { sto: th }, true, true);
