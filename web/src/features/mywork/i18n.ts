// Copy for the My work page. Namespaced `mw`.

import i18n from '../../lib/i18n';

const en = {
  title: 'My work', lede: 'Everything waiting on you in one list. Pick an item and finish it here.',
  alarms: 'Open alarms', stops: 'Stops without a reason', reviews: 'Decisions to review',
  empty: 'Nothing is waiting on you', emptyBody: 'New alarms, stops and truck decisions show up here.',
  pick: 'Pick an item from the list', pickBody: 'Details and actions appear here.',
  back: 'Back to list', loadErr: 'Could not load your work',
  needOperator: 'Operator role is needed to act on these items.',
  ack: 'Acknowledge', acking: 'Acknowledging…', ackErr: 'Could not acknowledge. Try again.',
  openAlarm: 'Open alarm page', raised: 'Raised', severity: 'Severity', state: 'State',
  stopped: 'Stopped', duration: 'Duration', reason: 'Reason', pickReason: 'Select a reason…',
  note: 'Note (optional)', save: 'Save reason', saving: 'Saving…', saveErr: 'Could not save. Try again.',
  decision: 'Decision', margin: 'Margin', camera: 'Camera', uncertain: 'Uncertain',
  correct: 'Correct', wrong: 'Wrong', reviewErr: 'Could not save the review. Try again.',
  count: '{{n}} waiting',
};

const th: typeof en = {
  title: 'งานของฉัน', lede: 'ทุกอย่างที่รอคุณอยู่ในรายการเดียว เลือกงานแล้วทำให้เสร็จที่นี่',
  alarms: 'อลาร์มที่เปิดอยู่', stops: 'การหยุดที่ยังไม่ระบุสาเหตุ', reviews: 'ผลตัดสินที่รอตรวจ',
  empty: 'ตอนนี้ไม่มีงานรอคุณ', emptyBody: 'อลาร์ม การหยุด และผลตัดสินรถใหม่จะขึ้นที่นี่',
  pick: 'เลือกงานจากรายการ', pickBody: 'รายละเอียดและปุ่มดำเนินการจะแสดงตรงนี้',
  back: 'กลับไปที่รายการ', loadErr: 'โหลดงานของคุณไม่สำเร็จ',
  needOperator: 'ต้องมีบทบาทผู้ปฏิบัติงานจึงจะดำเนินการได้',
  ack: 'รับทราบ', acking: 'กำลังรับทราบ…', ackErr: 'รับทราบไม่สำเร็จ ลองอีกครั้ง',
  openAlarm: 'เปิดหน้าอลาร์ม', raised: 'เกิดเมื่อ', severity: 'ระดับ', state: 'สถานะ',
  stopped: 'หยุดเมื่อ', duration: 'ระยะเวลา', reason: 'สาเหตุ', pickReason: 'เลือกสาเหตุ…',
  note: 'หมายเหตุ (ไม่บังคับ)', save: 'บันทึกสาเหตุ', saving: 'กำลังบันทึก…', saveErr: 'บันทึกไม่สำเร็จ ลองอีกครั้ง',
  decision: 'ผลตัดสิน', margin: 'ส่วนต่าง', camera: 'กล้อง', uncertain: 'ไม่แน่ใจ',
  correct: 'ถูกต้อง', wrong: 'ผิด', reviewErr: 'บันทึกผลตรวจไม่สำเร็จ ลองอีกครั้ง',
  count: 'รอ {{n}} รายการ',
};

i18n.addResourceBundle('en', 'translation', { mw: en }, true, true);
i18n.addResourceBundle('th', 'translation', { mw: th }, true, true);
