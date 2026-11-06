// F10 decision-compare strings (f10.*).

import i18n from '../../lib/i18n';

i18n.addResourceBundle('en', 'translation', {
  f10: {
    title: 'Compare options', lede: 'Silo running low: compare what each choice leaves you, then decide. Nothing happens until you do.',
    silo: 'Silo', lead: 'Tanker lead time (min)', reserve: 'Reserve level',
    now: 'Now', burn: 'Use over last 2 h', perHour: '{{v}} %/h', noDraw: 'No use seen',
    noData: 'No level history for this silo yet.', loadFailed: 'Could not load the level history.',
    formulaHead: 'How this is worked out', burnFormula: 'r = sum of drops between samples ÷ hours',
    opt_refill_now: 'Refill now', opt_refill_later: 'Refill later', opt_switch_source: 'Switch the source',
    desc_refill_now: 'Order a tanker now.', desc_refill_later: 'Wait, then order.', desc_switch_source: 'Draw from silo {{n}} instead.',
    desc_switch_none: 'No other silo holds enough.',
    hours: '{{v}} h', ok: 'Enough margin', tight: 'Tight', margin: 'Margin',
    leadMark: 'Tanker lead time',
    review: 'Review', reviewing: 'Review: {{name}}', close: 'Close',
    reason: 'Reason, kept with the record', reasonPlaceholder: 'Why this option',
    reasonRequired: 'Write a reason of at least 3 characters.',
    record: 'Record decision', recording: 'Recording', recorded: 'Decision recorded.', recordFailed: 'Could not record the decision.',
    humanNote: 'You decide. Recording a choice sends nothing to the plant.',
    openSheet: 'Open the control sheet', sheetHint: 'Starting silo {{n}} goes through the guarded command sheet.',
    history: 'Earlier decisions', historyEmpty: 'No decisions recorded for this silo yet.',
    by: 'by', viewerOnly: 'Your role can compare but not record decisions.',
  },
}, true, true);

i18n.addResourceBundle('th', 'translation', {
  f10: {
    title: 'เทียบทางเลือก', lede: 'ไซโลใกล้หมด: ดูว่าแต่ละทางเลือกเหลืออะไรให้ใช้ แล้วค่อยตัดสินใจ ระบบจะไม่ทำอะไรจนกว่าคุณจะสั่ง',
    silo: 'ไซโล', lead: 'เวลารอรถขนส่ง (นาที)', reserve: 'ระดับสำรอง',
    now: 'ตอนนี้', burn: 'อัตราใช้ใน 2 ชม.ล่าสุด', perHour: '{{v}} %/ชม.', noDraw: 'ไม่พบการใช้',
    noData: 'ยังไม่มีประวัติระดับของไซโลนี้', loadFailed: 'โหลดประวัติระดับไม่ได้',
    formulaHead: 'วิธีคำนวณ', burnFormula: 'r = ผลรวมระดับที่ลดลงระหว่างตัวอย่าง ÷ ชั่วโมง',
    opt_refill_now: 'เติมเลย', opt_refill_later: 'เติมทีหลัง', opt_switch_source: 'เปลี่ยนแหล่งจ่าย',
    desc_refill_now: 'สั่งรถขนส่งตอนนี้', desc_refill_later: 'รอก่อนแล้วค่อยสั่ง', desc_switch_source: 'ดึงจากไซโล {{n}} แทน',
    desc_switch_none: 'ไม่มีไซโลอื่นที่เหลือพอ',
    hours: '{{v}} ชม.', ok: 'เหลือเผื่อพอ', tight: 'ตึง', margin: 'ส่วนเผื่อ',
    leadMark: 'เวลารอรถขนส่ง',
    review: 'ตรวจทาน', reviewing: 'ตรวจทาน: {{name}}', close: 'ปิด',
    reason: 'เหตุผล เก็บไว้กับบันทึก', reasonPlaceholder: 'ทำไมจึงเลือกทางนี้',
    reasonRequired: 'เขียนเหตุผลอย่างน้อย 3 ตัวอักษร',
    record: 'บันทึกการตัดสินใจ', recording: 'กำลังบันทึก', recorded: 'บันทึกการตัดสินใจแล้ว', recordFailed: 'บันทึกการตัดสินใจไม่ได้',
    humanNote: 'คุณเป็นผู้ตัดสิน การบันทึกไม่ได้ส่งอะไรไปยังโรงงาน',
    openSheet: 'เปิดหน้าส่งคำสั่ง', sheetHint: 'การสตาร์ตไซโล {{n}} ต้องผ่านหน้าส่งคำสั่งที่มีการตรวจสอบ',
    history: 'การตัดสินใจก่อนหน้า', historyEmpty: 'ยังไม่มีการตัดสินใจของไซโลนี้',
    by: 'โดย', viewerOnly: 'สิทธิ์ของคุณเทียบได้แต่บันทึกการตัดสินใจไม่ได้',
  },
}, true, true);
