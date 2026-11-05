// Strings for the R2 viz kit (web/src/viz). Namespaced viz2.* — `viz.*`
// belongs to the trends bundle.

import i18n from '../lib/i18n';

i18n.addResourceBundle('en', 'translation', {
  viz2: {
    emptyWindow: 'No data in {{range}} — values appear here as soon as the signal reports.',
    empty: 'No data yet — values appear here as soon as the signal reports.',
    stale: 'Not current',
    staleAt: 'Last value {{age}}',
    refetching: 'Updating…',
    fullscreen: 'Full screen',
    menu: 'Panel menu',
    info: 'About this panel',
    showTable: 'Table', showChart: 'Chart',
    deltaVs: 'vs {{w}} ago',
    flat: 'steady',
    target: 'Target {{v}}',
    deviation: '{{pct}}% off target',
    other: 'Other',
    cumulative: 'Cumulative share',
    running: 'Running', stopped: 'Stopped', fault: 'Fault', nodata: 'No data',
    duration: '{{from}}–{{to}} · {{d}}',
    heatLabel: '{{count}} alarms between {{from}} and {{to}}',
    live: 'Live', pause: 'Pause', resume: 'Resume live', custom: 'Custom range', apply: 'Apply',
    from: 'From', to: 'To', compare: 'Compare with previous period', previous: 'previous',
    smallMultiples: 'More than five signals — shown as separate charts so no colour repeats.',
    isolateHint: 'Click to show only this series; Ctrl-click to hide or show it.',
  },
}, true, true);

i18n.addResourceBundle('th', 'translation', {
  viz2: {
    emptyWindow: 'ไม่มีข้อมูลในช่วง {{range}} ค่าจะแสดงทันทีที่สัญญาณส่งข้อมูลเข้ามา',
    empty: 'ยังไม่มีข้อมูล ค่าจะแสดงทันทีที่สัญญาณส่งข้อมูลเข้ามา',
    stale: 'ไม่เป็นปัจจุบัน',
    staleAt: 'ค่าล่าสุดเมื่อ {{age}}',
    refetching: 'กำลังอัปเดต…',
    fullscreen: 'เต็มจอ',
    menu: 'เมนูแผงข้อมูล',
    info: 'เกี่ยวกับแผงข้อมูลนี้',
    showTable: 'ตาราง', showChart: 'กราฟ',
    deltaVs: 'เทียบกับ {{w}} ก่อน',
    flat: 'คงที่',
    target: 'เป้าหมาย {{v}}',
    deviation: 'ต่างจากเป้าหมาย {{pct}}%',
    other: 'อื่น ๆ',
    cumulative: 'สัดส่วนสะสม',
    running: 'ทำงาน', stopped: 'หยุด', fault: 'ขัดข้อง', nodata: 'ไม่มีข้อมูล',
    duration: '{{from}}–{{to}} · {{d}}',
    heatLabel: 'สัญญาณเตือน {{count}} ครั้ง ระหว่าง {{from}} ถึง {{to}}',
    live: 'สด', pause: 'หยุดชั่วคราว', resume: 'กลับไปดูสด', custom: 'กำหนดช่วงเอง', apply: 'ใช้',
    from: 'จาก', to: 'ถึง', compare: 'เทียบกับช่วงก่อนหน้า', previous: 'ช่วงก่อน',
    smallMultiples: 'มีสัญญาณมากกว่าห้าเส้น จึงแยกเป็นหลายกราฟเพื่อไม่ให้สีซ้ำกัน',
    isolateHint: 'คลิกเพื่อแสดงเฉพาะเส้นนี้ กด Ctrl ค้างแล้วคลิกเพื่อซ่อนหรือแสดง',
  },
}, true, true);
