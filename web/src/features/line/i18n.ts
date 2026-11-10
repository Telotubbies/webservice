// F05 auditable-command strings (f05.*) and the `unknown` lifecycle label.

import i18n from '../../lib/i18n';

i18n.addResourceBundle('en', 'translation', {
  lifecycle: { unknown: 'Not confirmed' },
  f05: {
    whatHappens: 'What should happen',
    start: 'Start', stop: 'Stop', setpoint: 'Change setpoint',
    titleStart: 'Start the conveyor', titleStop: 'Stop the conveyor', titleSetpoint: 'Change speed setpoint to {{v}} Hz',
    expectStart: 'The belt starts moving and material flows to the bin. Check the line is clear.',
    expectStop: 'The belt stops and production on line 1 halts until someone starts it again.',
    expectSetpoint: 'The setpoint becomes {{v}} Hz. The edge writes it to the PLC and reads it back to confirm.',
    reasonLabel: 'Reason, kept in the audit log', reasonPick: 'Choose a reason',
    reasonPlan: 'Production plan', reasonAlarm: 'Respond to an alarm', reasonMaint: 'Maintenance', reasonOther: 'Other',
    reasonOtherLabel: 'Describe the reason', reasonRequired: 'Choose or write a reason before sending.',
    checks: 'Checks before sending', notChecked: 'Not checked yet. Press Test without sending.',
    test: 'Test without sending', testing: 'Testing', send: 'Send command', cancel: 'Cancel', sending: 'Sending',
    testOk: 'Test passed. Nothing was sent.', testFail: 'Test failed. Nothing was sent.',
    after: 'After you send: checked, sent to gateway, written to PLC, read back. Safety interlocks stay in the PLC. This console cannot override them.',
    c_reason: 'Reason given', c_area: 'You can operate this area', c_writable: 'Signal accepts commands',
    c_type: 'Value has the right type', c_range: 'Value is inside the allowed range', c_permissive: 'Permissive condition is met',
    c_in_flight: 'No other command is in progress', c_edge: 'Edge is online',
    e_reason_required: 'A reason is required', e_reason_too_long: 'Reason is too long (200 characters at most)',
    e_area_forbidden: 'You do not have rights for this area', e_not_writable: 'This signal cannot be written',
    e_invalid_value: 'The value has the wrong type', e_out_of_range: 'Outside the allowed range {{min}} to {{max}}',
    e_permissive_not_met: 'Blocked by a condition: {{tag}} ({{why}})', e_command_in_flight: 'Another command is still in progress',
    e_edge_offline: 'Edge is offline',
    why_not_satisfied: 'not satisfied', why_stale: 'reading too old', why_bad_quality: 'bad quality', why_missing: 'no reading',
    outOk: 'Done. Read back {{v}}.', outMismatch: 'Not successful. The PLC reads {{actual}}, expected {{expected}}.',
    outUnknown: 'Not confirmed. The value was sent but could not be read back ({{why}}). Check the line before sending again.',
    outTimeout: 'Not successful. No reply arrived in time. Treat the command as not done.',
    outDenied: 'Not successful. The command was refused ({{why}}).', outFailed: 'Not successful ({{why}}).',
    outWaiting: 'Waiting for the PLC read-back.',
    colReason: 'Reason', colResult: 'Result', noReason: 'No reason recorded', auditLink: 'Audit log',
  },
}, true, true);

i18n.addResourceBundle('th', 'translation', {
  lifecycle: { unknown: 'ยังไม่ยืนยัน' },
  f05: {
    whatHappens: 'สิ่งที่ควรเกิดขึ้น',
    start: 'เริ่ม', stop: 'หยุด', setpoint: 'เปลี่ยนค่าตั้ง',
    titleStart: 'เริ่มสายพาน', titleStop: 'หยุดสายพาน', titleSetpoint: 'เปลี่ยนค่าตั้งความเร็วเป็น {{v}} Hz',
    expectStart: 'สายพานจะเริ่มเคลื่อนและวัสดุไหลไปที่ถังรับ ตรวจสอบว่าไลน์ปลอดภัย',
    expectStop: 'สายพานจะหยุด และการผลิตไลน์ 1 จะหยุดจนกว่าจะมีคนสั่งเริ่มใหม่',
    expectSetpoint: 'ค่าตั้งจะเป็น {{v}} Hz edge จะเขียนค่าลง PLC แล้วอ่านกลับเพื่อยืนยัน',
    reasonLabel: 'เหตุผล เก็บไว้ในบันทึกตรวจสอบ', reasonPick: 'เลือกเหตุผล',
    reasonPlan: 'แผนการผลิต', reasonAlarm: 'ตอบสนองสัญญาณเตือน', reasonMaint: 'บำรุงรักษา', reasonOther: 'อื่น ๆ',
    reasonOtherLabel: 'อธิบายเหตุผล', reasonRequired: 'เลือกหรือพิมพ์เหตุผลก่อนส่ง',
    checks: 'ตรวจก่อนส่ง', notChecked: 'ยังไม่ได้ตรวจ กด ทดสอบโดยไม่ส่ง',
    test: 'ทดสอบโดยไม่ส่ง', testing: 'กำลังทดสอบ', send: 'ส่งคำสั่ง', cancel: 'ยกเลิก', sending: 'กำลังส่ง',
    testOk: 'ผ่านการทดสอบ ยังไม่มีการส่งคำสั่ง', testFail: 'ไม่ผ่านการทดสอบ ยังไม่มีการส่งคำสั่ง',
    after: 'หลังส่ง: ตรวจ ส่งไปที่เกตเวย์ เขียนลง PLC แล้วอ่านกลับ ระบบอินเตอร์ล็อกเพื่อความปลอดภัยอยู่ใน PLC คอนโซลนี้ข้ามไม่ได้',
    c_reason: 'ระบุเหตุผลแล้ว', c_area: 'คุณมีสิทธิ์ควบคุมพื้นที่นี้', c_writable: 'สัญญาณรับคำสั่งได้',
    c_type: 'ชนิดของค่าถูกต้อง', c_range: 'ค่าอยู่ในช่วงที่อนุญาต', c_permissive: 'เงื่อนไขอนุญาตครบ',
    c_in_flight: 'ไม่มีคำสั่งอื่นค้างอยู่', c_edge: 'edge ออนไลน์',
    e_reason_required: 'ต้องระบุเหตุผล', e_reason_too_long: 'เหตุผลยาวเกินไป (ไม่เกิน 200 ตัวอักษร)',
    e_area_forbidden: 'คุณไม่มีสิทธิ์ในพื้นที่นี้', e_not_writable: 'สัญญาณนี้เขียนค่าไม่ได้',
    e_invalid_value: 'ชนิดของค่าไม่ถูกต้อง', e_out_of_range: 'อยู่นอกช่วงที่อนุญาต {{min}} ถึง {{max}}',
    e_permissive_not_met: 'ถูกบล็อกด้วยเงื่อนไข: {{tag}} ({{why}})', e_command_in_flight: 'ยังมีคำสั่งอื่นค้างอยู่',
    e_edge_offline: 'edge ออฟไลน์',
    why_not_satisfied: 'ยังไม่ครบเงื่อนไข', why_stale: 'ค่าเก่าเกินไป', why_bad_quality: 'คุณภาพข้อมูลไม่ดี', why_missing: 'ไม่มีค่า',
    outOk: 'สำเร็จ อ่านกลับได้ {{v}}', outMismatch: 'ไม่สำเร็จ PLC อ่านได้ {{actual}} แต่คาดไว้ {{expected}}',
    outUnknown: 'ยังไม่ยืนยัน ส่งค่าแล้วแต่อ่านกลับไม่ได้ ({{why}}) ตรวจไลน์ก่อนส่งซ้ำ',
    outTimeout: 'ไม่สำเร็จ ไม่มีการตอบกลับทันเวลา ให้ถือว่าคำสั่งยังไม่ทำงาน',
    outDenied: 'ไม่สำเร็จ คำสั่งถูกปฏิเสธ ({{why}})', outFailed: 'ไม่สำเร็จ ({{why}})',
    outWaiting: 'กำลังรอการอ่านกลับจาก PLC',
    colReason: 'เหตุผล', colResult: 'ผลลัพธ์', noReason: 'ไม่มีเหตุผลบันทึกไว้', auditLink: 'บันทึกตรวจสอบ',
  },
}, true, true);

// Side view (process-flow elevation of the plant parts) — namespaced `side`.
i18n.addResourceBundle('en', 'translation', {
  side: {
    tab: 'Side view', schematic: 'Schematic', view: 'View',
    title: 'Plant side view', hint: 'Parts are drawn at one scale, in process order from left to right. Select a part to open its panel.',
    scroll: 'Swipe sideways to see the whole plant.', parts: 'Parts', loading: 'Loading the plant…', empty: 'Select a part to see its signals.',
    run: 'Running', stop: 'Stopped', alarm: 'Alarm', stale: 'No data', live: 'Live data', none: 'Not monitored',
    g_agg: 'Aggregate bins', g_belts: 'Belts', g_hoist: 'Skip hoist', g_mix: 'Mixing',
    g_liq: 'Water and admixture', g_cem: 'Cement silos', g_air: 'Air and dust',
    part: '{{name}}, {{state}}', bucket: 'bucket at {{pct}}%',
  },
}, true, true);
i18n.addResourceBundle('th', 'translation', {
  side: {
    tab: 'ผังด้านข้าง', schematic: 'ผังไลน์', view: 'มุมมอง',
    title: 'ผังด้านข้างของโรงงาน', hint: 'ชิ้นส่วนวาดในมาตราส่วนเดียวกัน เรียงตามลำดับกระบวนการจากซ้ายไปขวา เลือกชิ้นส่วนเพื่อเปิดแผงรายละเอียด',
    scroll: 'เลื่อนไปด้านข้างเพื่อดูทั้งโรงงาน', parts: 'ชิ้นส่วน', loading: 'กำลังโหลดโรงงาน…', empty: 'เลือกชิ้นส่วนเพื่อดูสัญญาณ',
    run: 'กำลังเดิน', stop: 'หยุด', alarm: 'สัญญาณเตือน', stale: 'ไม่มีข้อมูล', live: 'มีข้อมูลสด', none: 'ไม่ได้เฝ้าติดตาม',
    g_agg: 'ถังวัสดุมวลรวม', g_belts: 'สายพาน', g_hoist: 'ลิฟต์สกิป', g_mix: 'ผสม',
    g_liq: 'น้ำและน้ำยา', g_cem: 'ไซโลซีเมนต์', g_air: 'ลมและฝุ่น',
    part: '{{name}} {{state}}', bucket: 'กระบะอยู่ที่ {{pct}}%',
  },
}, true, true);

// Console v6 line page (D2): page chrome, the equipment grid, the lower tabs
// and the dock. Namespaced `d2` so the older `line.*` copy stays untouched.
i18n.addResourceBundle('en', 'translation', {
  d2: {
    info: 'This console watches the line and sends audited commands. It is not a safety system: interlocks and the emergency stop stay in the PLC. Every command needs a reason and is logged.',
    toolbar: 'Line controls', tools: 'Line', views: 'View',
    refresh: 'Refresh', command: 'Command', alarms: 'Alarms', side: 'Side view', schematic: 'Schematic',
    equipment: 'Equipment ({{n}})', filter: 'Filter equipment or tag', filterEmpty: 'No equipment matches this filter.',
    selected: 'Selected equipment', notCurrent: 'Not current', noReading: 'No reading', noRunSignal: 'No run signal on this equipment',
    limits: 'Limits', limitsFrom: 'from the alarm rules', noLimits: 'No limits configured for this signal.',
    lastCommand: 'Last command', neverCommanded: 'No command yet', dimState: 'State', dimTime: 'Time', range: 'Range',
    commands: 'Commands', messageLog: 'Message log',
    colName: 'Name', colTag: 'Tag', colLive: 'Live value', colValue: 'Value', colRaw: 'Raw',
    colLimits: 'Limits', colLast: 'Last command', colState: 'State', colQuality: 'Quality',
    cmdTarget: 'Target', cmdValue: 'Value', cmdReason: 'Reason', cmdCheck: 'Check', cmdStatus: 'Status', cmdTime: 'Asked',
    noCommands: 'No commands on this line yet', noCommandsBody: 'Start, stop and setpoint changes from this page appear here with their reason and result.',
    noMessages: 'No messages yet', noMessagesBody: 'Alarm and command activity on this line appears here.',
    noCommandAccess: 'Command history is hidden for your role', noCommandAccessBody: 'Viewers can see live values and alarms but not the audited command list.',
    log: 'Log', events: 'Events', level: 'Log level', levelInfo: 'Info', levelWarning: 'Warning', levelError: 'Critical',
    logEmpty: 'Nothing at this level yet.', eventsEmpty: 'No alarm events yet.',
    receiving: 'Receiving · last value {{age}}', lastValue: 'Last value {{age}}', feedDown: 'Live feed offline',
    viewerNote: 'Read only. Viewers can see this page but cannot send commands.',
    dockToggle: 'Show or hide the log dock',
  },
}, true, true);
i18n.addResourceBundle('th', 'translation', {
  d2: {
    info: 'คอนโซลนี้เฝ้าดูไลน์และส่งคำสั่งที่บันทึกตรวจสอบได้ ระบบนี้ไม่ใช่ระบบความปลอดภัย อินเตอร์ล็อกและปุ่มหยุดฉุกเฉินอยู่ใน PLC ทุกคำสั่งต้องมีเหตุผลและถูกบันทึกไว้',
    toolbar: 'เครื่องมือควบคุมไลน์', tools: 'ไลน์', views: 'มุมมอง',
    refresh: 'รีเฟรช', command: 'สั่งงาน', alarms: 'สัญญาณเตือน', side: 'ผังด้านข้าง', schematic: 'ผังไลน์',
    equipment: 'อุปกรณ์ ({{n}})', filter: 'กรองอุปกรณ์หรือแท็ก', filterEmpty: 'ไม่มีอุปกรณ์ที่ตรงกับคำกรอง',
    selected: 'อุปกรณ์ที่เลือก', notCurrent: 'ไม่เป็นปัจจุบัน', noReading: 'ไม่มีค่า', noRunSignal: 'อุปกรณ์นี้ไม่มีสัญญาณสถานะเดิน',
    limits: 'ขีดจำกัด', limitsFrom: 'จากกฎสัญญาณเตือน', noLimits: 'ยังไม่ได้ตั้งขีดจำกัดของสัญญาณนี้',
    lastCommand: 'คำสั่งล่าสุด', neverCommanded: 'ยังไม่มีคำสั่ง', dimState: 'สถานะ', dimTime: 'เวลา', range: 'ช่วงค่า',
    commands: 'คำสั่ง', messageLog: 'บันทึกข้อความ',
    colName: 'ชื่อ', colTag: 'แท็ก', colLive: 'ค่าสด', colValue: 'ค่า', colRaw: 'ค่าดิบ',
    colLimits: 'ขีดจำกัด', colLast: 'คำสั่งล่าสุด', colState: 'สถานะ', colQuality: 'คุณภาพ',
    cmdTarget: 'เป้าหมาย', cmdValue: 'ค่า', cmdReason: 'เหตุผล', cmdCheck: 'ผลตรวจ', cmdStatus: 'สถานะ', cmdTime: 'เวลาที่ขอ',
    noCommands: 'ยังไม่มีคำสั่งบนไลน์นี้', noCommandsBody: 'คำสั่งเดิน หยุด และเปลี่ยนค่าตั้งจากหน้านี้จะแสดงที่นี่พร้อมเหตุผลและผลลัพธ์',
    noMessages: 'ยังไม่มีข้อความ', noMessagesBody: 'กิจกรรมของสัญญาณเตือนและคำสั่งบนไลน์นี้จะแสดงที่นี่',
    noCommandAccess: 'ประวัติคำสั่งไม่แสดงสำหรับบทบาทของคุณ', noCommandAccessBody: 'ผู้ชมดูค่าสดและสัญญาณเตือนได้ แต่ไม่เห็นรายการคำสั่งที่บันทึกไว้',
    log: 'บันทึก', events: 'เหตุการณ์', level: 'ระดับบันทึก', levelInfo: 'ข้อมูล', levelWarning: 'เตือน', levelError: 'วิกฤต',
    logEmpty: 'ยังไม่มีรายการในระดับนี้', eventsEmpty: 'ยังไม่มีเหตุการณ์สัญญาณเตือน',
    receiving: 'รับข้อมูลอยู่ · ค่าล่าสุด {{age}}', lastValue: 'ค่าล่าสุด {{age}}', feedDown: 'การเชื่อมต่อข้อมูลสดขาด',
    viewerNote: 'อ่านได้อย่างเดียว บัญชีผู้ชมดูหน้านี้ได้แต่สั่งงานไม่ได้',
    dockToggle: 'แสดงหรือซ่อนแถบบันทึกด้านล่าง',
  },
}, true, true);
