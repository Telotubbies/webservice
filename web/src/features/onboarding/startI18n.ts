// Copy for the "Start here" panel (`start.*`) and the one-line group
// descriptions under each rail flyout title (`navDesc.*`, keyed by the nav
// group key without its `nav.` prefix).

import i18n from '../../lib/i18n';

i18n.addResourceBundle('en', 'translation', {
  start: {
    button: 'Start here',
    title: 'Start here',
    lede: 'Three pages to open first, picked for your job. Switch if you do something else.',
    pathLabel: 'What do you do here?',
    path: { operator: 'Run the plant', engineer: 'Set it up', admin: 'Manage people' },
    step: {
      overview: 'Overview', overviewBody: 'Plant KPIs and what changed this shift.',
      alarms: 'Alarms', alarmsBody: 'Acknowledge what needs a person, highest priority first.',
      trends: 'Trends', trendsBody: 'Compare a signal against its alarm limits over time.',
      gateway: 'Add a gateway', gatewayBody: 'Bring the first edge device online so data flows.',
      tags: 'Tags', tagsBody: 'Name the PLC signals people will read.',
      rule: 'New alarm rule', ruleBody: 'Say when a value needs someone’s attention.',
      invite: 'Invite people', inviteBody: 'Give each person the role that fits their work.',
      notify: 'Notification channels', notifyBody: 'Choose where alarms reach people off-screen.',
      org: 'Organization', orgBody: 'Sites, name and policy for this workspace.',
    },
    checklist: 'Setup checklist',
    checklistProgress: '{{done}} of {{total}} done',
    guide: 'User guide',
    shortcuts: 'Keyboard shortcuts',
    hide: 'Hide this button',
    hidden: 'Hidden — reopen it from your user menu.',
    menuItem: 'Start here',
    progressAria: 'Setup {{done}} of {{total}} done',
  },
  navDesc: {
    live: 'The line as it runs: mimic, wall display and operator commands.',
    alarms: 'What needs attention now, plus alarm history, quality and maintenance windows.',
    production: 'OEE, stops, shifts and reports for the time you produced.',
    dashboards: 'Boards and notebooks you build from any signal.',
    plantSetup: 'The plant model: structure, 3D mapping, tags, alarm rules and channels.',
    connectivity: 'Gateways, PLC data sources and their health.',
    vision: 'Cameras, inspection models and their rules and events.',
    platformTools: 'Observability depth: monitors, logs, queries, security and AI insights.',
    admin: 'People, access, audit log, storage and workspace settings.',
  },
}, true, true);

i18n.addResourceBundle('th', 'translation', {
  start: {
    button: 'เริ่มต้นที่นี่',
    title: 'เริ่มต้นที่นี่',
    lede: 'สามหน้าที่ควรเปิดก่อน เลือกตามงานของคุณ ถ้าทำงานอื่นเปลี่ยนได้',
    pathLabel: 'คุณทำงานส่วนไหน',
    path: { operator: 'เดินเครื่อง', engineer: 'ติดตั้งระบบ', admin: 'ดูแลผู้ใช้' },
    step: {
      overview: 'ภาพรวม', overviewBody: 'KPI ของโรงงานและสิ่งที่เปลี่ยนไปในกะนี้',
      alarms: 'สัญญาณเตือน', alarmsBody: 'รับทราบเรื่องที่ต้องมีคนดู เรียงจากสำคัญที่สุด',
      trends: 'แนวโน้ม', trendsBody: 'เทียบค่าสัญญาณกับขีดจำกัดการแจ้งเตือนตามเวลา',
      gateway: 'เพิ่มเกตเวย์', gatewayBody: 'เชื่อมอุปกรณ์ edge ตัวแรกเพื่อให้ข้อมูลเข้ามา',
      tags: 'แท็ก', tagsBody: 'ตั้งชื่อสัญญาณจาก PLC ที่ทุกคนจะอ่าน',
      rule: 'สร้างกฎแจ้งเตือน', ruleBody: 'กำหนดว่าค่าแบบไหนต้องมีคนมาดู',
      invite: 'เชิญผู้ใช้', inviteBody: 'ให้สิทธิ์แต่ละคนตามงานที่ทำ',
      notify: 'ช่องทางแจ้งเตือน', notifyBody: 'เลือกว่าการแจ้งเตือนจะส่งถึงคนนอกหน้าจอทางไหน',
      org: 'องค์กร', orgBody: 'ไซต์ ชื่อ และนโยบายของพื้นที่ทำงานนี้',
    },
    checklist: 'รายการตั้งค่าเริ่มต้น',
    checklistProgress: 'เสร็จ {{done}} จาก {{total}}',
    guide: 'คู่มือผู้ใช้',
    shortcuts: 'แป้นพิมพ์ลัด',
    hide: 'ซ่อนปุ่มนี้',
    hidden: 'ซ่อนแล้ว เปิดอีกครั้งได้จากเมนูผู้ใช้',
    menuItem: 'เริ่มต้นที่นี่',
    progressAria: 'ตั้งค่าแล้ว {{done}} จาก {{total}}',
  },
  navDesc: {
    live: 'สายการผลิตขณะเดินเครื่อง: ผังจำลอง จอรวม และคำสั่งผู้ควบคุม',
    alarms: 'สิ่งที่ต้องดูตอนนี้ พร้อมประวัติ คุณภาพการแจ้งเตือน และช่วงซ่อมบำรุง',
    production: 'OEE การหยุดเครื่อง กะ และรายงานของช่วงที่ผลิต',
    dashboards: 'บอร์ดและโน้ตบุ๊กที่สร้างจากสัญญาณใดก็ได้',
    plantSetup: 'โมเดลโรงงาน: โครงสร้าง การจับคู่ 3D แท็ก กฎแจ้งเตือน และช่องทาง',
    connectivity: 'เกตเวย์ แหล่งข้อมูล PLC และสถานะการเชื่อมต่อ',
    vision: 'กล้อง โมเดลตรวจสอบ กฎ และเหตุการณ์ของ Vision',
    platformTools: 'เครื่องมือเชิงลึก: มอนิเตอร์ ล็อก คิวรี ความปลอดภัย และ AI insights',
    admin: 'ผู้ใช้ สิทธิ์ บันทึกตรวจสอบ พื้นที่จัดเก็บ และการตั้งค่า',
  },
}, true, true);
