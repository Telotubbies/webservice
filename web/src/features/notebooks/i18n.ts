import i18n from '../../lib/i18n';

i18n.addResourceBundle('en', 'translation', {
  nb: {
    title: 'Notebooks', new: 'New notebook', blank: 'Blank notebook', fromTemplate: 'From template',
    search: 'Search notebooks', mock: 'Demo: notebooks are stored in this browser only (localStorage) and are not shared with other users.',
    colName: 'Name', colAuthor: 'Author', colCells: 'Cells', colUpdated: 'Modified', colTemplate: 'Type',
    empty: 'No notebooks yet', emptyBody: 'Start a shift handover or downtime investigation from a template.',
    noMatch: 'No notebooks match your search', showing: '{{shown}} of {{total}} notebooks',
    tpl: { handover: 'Shift handover', downtime: 'Downtime investigation', blank: 'Blank' },
    notFound: 'Notebook not found', back: 'Back to notebooks', titleLabel: 'Notebook title',
    addText: 'Text', addSeries: 'Timeseries', addAlarms: 'Alarm list', addCell: 'Add cell',
    up: 'Move cell up', down: 'Move cell down', del: 'Delete cell', edit: 'Edit', done: 'Done',
    deleteNb: 'Delete notebook', confirmDelete: 'Delete this notebook? This cannot be undone.',
    cellText: 'Text cell', cellSeries: 'Timeseries cell', cellAlarms: 'Alarm list cell',
    tags: 'Tags', range: 'Range', pickTags: 'Pick up to 6 tags', noCells: 'This notebook is empty — add a cell below.',
    emptyText: 'Empty text — click Edit to write.', tagsErr: 'Tags could not be loaded', saveErr: 'Could not save to this browser',
    seed: {
      handoverTitle: 'Shift handover — Line 1',
      handoverText: '# Shift summary\n- Line state:\n- Production notes:\n- Open issues for next shift:',
      handoverAlarms: '## Open alarms at handover',
      downtimeTitle: 'Downtime investigation',
      downtimeText: '# What happened\n- Start time:\n- Equipment:\n- Symptom:\n\n# Root cause\n\n# Corrective action',
      downtimeTrend: '## Signals around the stop',
    },
  },
}, true, true);

i18n.addResourceBundle('th', 'translation', {
  nb: {
    title: 'สมุดบันทึก', new: 'สมุดใหม่', blank: 'สมุดเปล่า', fromTemplate: 'จากแม่แบบ',
    search: 'ค้นหาสมุดบันทึก', mock: 'เดโม: สมุดบันทึกเก็บไว้ในเบราว์เซอร์นี้เท่านั้น (localStorage) ผู้ใช้อื่นมองไม่เห็น',
    colName: 'ชื่อ', colAuthor: 'ผู้เขียน', colCells: 'เซลล์', colUpdated: 'แก้ไขล่าสุด', colTemplate: 'ประเภท',
    empty: 'ยังไม่มีสมุดบันทึก', emptyBody: 'เริ่มบันทึกส่งกะหรือสอบสวนเครื่องหยุดจากแม่แบบ',
    noMatch: 'ไม่พบสมุดที่ตรงกับคำค้น', showing: '{{shown}} จาก {{total}} สมุด',
    tpl: { handover: 'ส่งมอบกะ', downtime: 'สอบสวนเครื่องหยุด', blank: 'เปล่า' },
    notFound: 'ไม่พบสมุดบันทึก', back: 'กลับไปที่สมุดบันทึก', titleLabel: 'ชื่อสมุดบันทึก',
    addText: 'ข้อความ', addSeries: 'กราฟเวลา', addAlarms: 'รายการสัญญาณเตือน', addCell: 'เพิ่มเซลล์',
    up: 'เลื่อนเซลล์ขึ้น', down: 'เลื่อนเซลล์ลง', del: 'ลบเซลล์', edit: 'แก้ไข', done: 'เสร็จ',
    deleteNb: 'ลบสมุดบันทึก', confirmDelete: 'ลบสมุดบันทึกนี้? ไม่สามารถย้อนกลับได้',
    cellText: 'เซลล์ข้อความ', cellSeries: 'เซลล์กราฟเวลา', cellAlarms: 'เซลล์รายการสัญญาณเตือน',
    tags: 'แท็ก', range: 'ช่วงเวลา', pickTags: 'เลือกได้ไม่เกิน 6 แท็ก', noCells: 'สมุดนี้ว่าง — เพิ่มเซลล์ด้านล่าง',
    emptyText: 'ยังไม่มีข้อความ — กดแก้ไขเพื่อเขียน', tagsErr: 'โหลดรายการแท็กไม่สำเร็จ', saveErr: 'บันทึกลงเบราว์เซอร์ไม่สำเร็จ',
    seed: {
      handoverTitle: 'ส่งมอบกะ — ไลน์ 1',
      handoverText: '# สรุปกะ\n- สถานะไลน์:\n- บันทึกการผลิต:\n- ปัญหาค้างสำหรับกะถัดไป:',
      handoverAlarms: '## สัญญาณเตือนที่ค้างตอนส่งกะ',
      downtimeTitle: 'สอบสวนเครื่องหยุด',
      downtimeText: '# เกิดอะไรขึ้น\n- เวลาเริ่ม:\n- เครื่องจักร:\n- อาการ:\n\n# สาเหตุราก\n\n# การแก้ไข',
      downtimeTrend: '## สัญญาณช่วงที่เครื่องหยุด',
    },
  },
}, true, true);
