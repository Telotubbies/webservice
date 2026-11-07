// Copy for the AI write approval page. Namespaced `arm`.

import i18n from '../../lib/i18n';

const en = {
  title: 'AI write approval', lede: 'AI may write to your PLCs from a site only after a person approves that site.',
  armed: 'This site is approved', notArmed: 'This site is not approved', since: 'Approved on {{when}}.', evidence: 'What was reviewed',
  evidencePh: 'e.g. dry-run review 2026-11-03, ticket 1234', explain: 'Until you approve, AI decisions are only shown, never written. Approving needs a fresh sign-in and is recorded in the audit trail.',
  arm: 'Approve this site', disarm: 'Withdraw approval',
  note: 'Approval does not switch off dry-run on any rule. It only allows a rule that is already live to write.',
};
const th = {
  title: 'อนุมัติให้ AI เขียน PLC', lede: 'AI จะเขียนค่าไป PLC จากไซต์ใดไซต์หนึ่งได้ก็ต่อเมื่อมีคนอนุมัติไซต์นั้นแล้ว',
  armed: 'ไซต์นี้ได้รับอนุมัติแล้ว', notArmed: 'ไซต์นี้ยังไม่ได้รับอนุมัติ', since: 'อนุมัติเมื่อ {{when}}', evidence: 'สิ่งที่ตรวจสอบแล้ว',
  evidencePh: 'เช่น ตรวจผล dry-run 2026-11-03 ตั๋ว 1234', explain: 'จนกว่าจะอนุมัติ ผลตัดสินของ AI จะแสดงเท่านั้น ไม่เขียนค่า การอนุมัติต้องเข้าสู่ระบบใหม่และบันทึกใน audit trail',
  arm: 'อนุมัติไซต์นี้', disarm: 'ถอนการอนุมัติ',
  note: 'การอนุมัติไม่ได้ปิด dry-run ของกฎใด แต่อนุญาตให้กฎที่เปิดใช้งานจริงอยู่แล้วเขียนค่าได้',
};

i18n.addResourceBundle('en', 'translation', { arm: en }, true, true);
i18n.addResourceBundle('th', 'translation', { arm: th }, true, true);
