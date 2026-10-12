// i18n — TH + EN (ADR-14). Keys are grouped by feature. `check-i18n` in
// scripts/ fails CI if a key exists in one language but not the other.

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

export const LANGS = ['en', 'th'] as const;
export type Lang = (typeof LANGS)[number];
const LANG_KEY = 'wds.lang';

const en = {
  nav: {
    monitor: 'Monitor', operate: 'Operate', system: 'System',
    overview: 'Overview', line: 'Line view', trends: 'Trends', alarms: 'Alarms',
    tags: 'Tags', commands: 'Commands', health: 'System health',
    intelligence: 'Intelligence', insights: 'Insights',
  },
  shell: {
    product: 'Line console', live: 'Live', connecting: 'Connecting', reconnecting: 'Reconnecting',
    offline: 'Offline', sessionExpired: 'Session expired', signIn: 'Sign in', signOut: 'Sign out',
    guest: 'Not signed in', alarmsButton: 'Active alarms: {{count}}',
    language: 'Language', viewAlarm: 'View alarm', viewAlarms: 'View alarms',
    criticalActive_one: '{{count}} critical alarm active: {{what}}',
    criticalActive_other: '{{count}} critical alarms active, latest: {{what}}',
    flood: 'Alarm flood: {{count}} active alarms. Alarms are grouped by rule.',
    tooSmallTitle: 'This screen is too small',
    tooSmallBody: 'Open the console on a display at least 480 px wide.',
  },
  roles: { operator: 'Operator', viewer: 'Viewer', custom: 'Custom token', none: 'Guest' },
  auth: {
    title: 'Sign in',
    body: 'Development sign-in. Paste an access token; single sign-on replaces this step in the next release.',
    token: 'Access token', submit: 'Sign in', cancel: 'Cancel',
    demoHint: 'Demo tokens: demo-operator (can operate), demo-viewer (read only).',
  },
  state: {
    running: 'Running', stopped: 'Stopped', stale: 'No data', unknown: 'Unknown',
    good: 'Good', bad: 'Bad quality', uncertain: 'Uncertain', staleQ: 'Stale',
    updated: 'Updated {{age}}', never: 'No data yet',
  },
  overview: {
    title: 'Overview', lede: 'Sorting line 1, live',
    lineState: 'Line state', beltSpeed: 'Belt speed', motorTemp: 'Belt temperature',
    binLevel: 'Bin level', gravelRatio: 'Gravel ratio', setpoint: 'Speed setpoint',
    activeAlarms: 'Active alarms', recentAlarms: 'Alarms', openLine: 'Open line view',
    noActive: 'No active alarms', noActiveBody: 'The line is running without abnormal conditions.',
    stub: 'Simulated', stubTitle: 'Vision pipeline not connected yet: this value is simulated',
    equipment: 'Equipment', limit: 'Alarm at {{v}}',
  },
  line: {
    title: 'Line view', lede: 'Select equipment to inspect it and, if permitted, operate it.',
    motor: 'Drive motor', conveyor: 'Conveyor', camera: 'Vision camera', bin: 'Gravel bin',
    inspector: 'Equipment', close: 'Close', signals: 'Signals', controls: 'Controls',
    selectHint: 'Select a piece of equipment on the drawing.',
  },
  control: {
    start: 'Start', stop: 'Stop', apply: 'Apply setpoint', newValue: 'New setpoint',
    range: 'Allowed {{min}} to {{max}} {{unit}}', current: 'Current',
    confirmStartTitle: 'Start the conveyor?', confirmStopTitle: 'Stop the conveyor?',
    confirmWriteTitle: 'Change the setpoint?',
    startConsequence: 'The belt starts moving and material flows to the bin. Check the line is clear.',
    stopConsequence: 'The belt stops and production on line 1 halts until it is started again.',
    writeConsequence: 'The motor ramps to the new speed. The PLC may refuse values outside its limits.',
    typeToConfirm: 'Type {{word}} to confirm',
    confirm: 'Send command', cancel: 'Cancel',
    tag: 'Signal', from: 'From', to: 'To',
    unavailable: 'Controls unavailable',
    reasonRole: 'Your role can view this line but not operate it.',
    reasonGuest: 'Sign in with an operator account to operate equipment.',
    reasonViewport: 'Equipment can only be operated from a workstation display (768 px or wider).',
    reasonEdge: 'The edge gateway is offline, so commands cannot reach the PLC.',
    reasonClock: 'The edge clock is not trusted, so the PLC would reject commands.',
    inFlight: 'Another command for this signal is still in progress.',
    sent: 'Command sent', failed: 'Command failed: {{reason}}',
    authFailed: 'Your session cannot send commands ({{status}}). Sign in as an operator.',
    plcFinal: 'The PLC makes the final decision and can refuse any command.',
    outOfRange: 'Enter a value from {{min}} to {{max}}.',
  },
  lifecycle: {
    accepted: 'Accepted', dispatched: 'Sent to edge', acknowledged: 'Done', rejected: 'Refused',
    failed: 'Failed', timeout: 'No response', issued: 'Accepted', sent: 'Sent to edge',
    done: 'Done', denied: 'Refused', acked: 'Received',
  },
  alarms: {
    title: 'Alarms', lede: 'Respond to active alarms first. Cleared alarms stay for the record.',
    active: 'Active', acked: 'Acknowledged', cleared: 'Cleared', all: 'All',
    severity: 'Severity', allSeverities: 'All severities',
    critical: 'Critical', warning: 'Warning', info: 'Advisory',
    colSeverity: 'Severity', colAlarm: 'Alarm', colSignal: 'Signal', colRaised: 'Raised',
    colDuration: 'Duration', colState: 'State', colAction: 'Action',
    ack: 'Acknowledge', ackedBy: 'Acknowledged by {{who}}',
    empty: 'No alarms in this view', emptyActive: 'No active alarms', emptyActiveBody: 'Nothing needs attention right now.',
    ackFailed: 'Could not acknowledge: {{reason}}',
    signInToAck: 'Sign in as an operator to acknowledge',
  },
  insights: {
    title: 'Insights', advisory: 'Advisory',
    kindAnomaly: 'Anomaly', kindDrift: 'Drift', kindFlatline: 'Flatline', kindFlapping: 'Flapping',
    score: 'Score', open: 'Open', closed: 'Closed',
    viewAll: 'View all', empty: 'No insights', openInTrends: 'Open in trends',
  },
  trends: {
    title: 'Trends', lede: 'Compare signals over time. Drag across the chart to zoom.',
    window: 'Time window', time: 'Time', signals: 'Signals', exportCsv: 'Export CSV',
    loading: 'Loading history', none: 'Select at least one signal.', max: 'Up to 6 signals',
    reset: 'Reset zoom',
  },
  tags: {
    title: 'Tags', lede: 'Every signal on this site with its live value and quality.',
    search: 'Search signals', colName: 'Signal', colPath: 'Path', colValue: 'Value',
    colQuality: 'Quality', colUpdated: 'Updated', colAccess: 'Access',
    writable: 'Writable', readonly: 'Read only', none: 'No signals match “{{q}}”.',
  },
  commands: {
    title: 'Commands', lede: 'Every command sent to the line, with who sent it and what happened.',
    colTime: 'Time', colSignal: 'Signal', colValue: 'Value', colUser: 'By', colStatus: 'Result',
    colDetail: 'Detail', empty: 'No commands yet', emptyBody: 'Commands sent from the line view appear here.',
    restricted: 'Command history is visible to operators only.',
    newCommand: 'New command',
  },
  health: {
    title: 'System health', lede: 'Connectivity from the PLC to this screen.',
    edge: 'Edge gateway', broker: 'Message broker', backend: 'Backend', database: 'Database',
    browser: 'This browser', up: 'Connected', down: 'Disconnected', stale: 'Not reporting',
    clock: 'Edge clock', clockOk: 'Synchronised', clockBad: 'Not trusted',
    lastHeartbeat: 'Last heartbeat', uptime: 'Uptime', wsClients: 'Live sessions',
    dropped: 'Dropped messages', unknownTags: 'Unknown signals dropped',
    path: 'Data path',
  },
  common: { retry: 'Try again', loading: 'Loading', error: 'Something went wrong', close: 'Close' },
  errors: {
    load: 'Could not load data from the backend.', loadBody: 'Check that the backend is running, then try again.',
  },
};

type Dict = typeof en;

const th: Dict = {
  nav: {
    monitor: 'เฝ้าระวัง', operate: 'ควบคุม', system: 'ระบบ',
    overview: 'ภาพรวม', line: 'ผังไลน์', trends: 'กราฟแนวโน้ม', alarms: 'สัญญาณเตือน',
    tags: 'สัญญาณ', commands: 'ประวัติคำสั่ง', health: 'สถานะระบบ',
    intelligence: 'ข้อมูลเชิงลึก', insights: 'อินไซต์',
  },
  shell: {
    product: 'คอนโซลไลน์ผลิต', live: 'สด', connecting: 'กำลังเชื่อมต่อ', reconnecting: 'กำลังเชื่อมต่อใหม่',
    offline: 'ออฟไลน์', sessionExpired: 'เซสชันหมดอายุ', signIn: 'เข้าสู่ระบบ', signOut: 'ออกจากระบบ',
    guest: 'ยังไม่ได้เข้าสู่ระบบ', alarmsButton: 'สัญญาณเตือนที่ยังเกิดอยู่: {{count}}',
    language: 'ภาษา', viewAlarm: 'ดูสัญญาณเตือน', viewAlarms: 'ดูสัญญาณเตือน',
    criticalActive_one: 'มีสัญญาณเตือนวิกฤต {{count}} รายการ: {{what}}',
    criticalActive_other: 'มีสัญญาณเตือนวิกฤต {{count}} รายการ ล่าสุด: {{what}}',
    flood: 'สัญญาณเตือนท่วม: {{count}} รายการ ระบบจัดกลุ่มตามกฎให้แล้ว',
    tooSmallTitle: 'หน้าจอเล็กเกินไป',
    tooSmallBody: 'เปิดคอนโซลบนจอที่กว้างอย่างน้อย 480 พิกเซล',
  },
  roles: { operator: 'ผู้ควบคุม', viewer: 'ผู้ดู', custom: 'โทเคนกำหนดเอง', none: 'ผู้เยี่ยมชม' },
  auth: {
    title: 'เข้าสู่ระบบ',
    body: 'การเข้าสู่ระบบสำหรับการพัฒนา วางโทเคนการเข้าถึง ระบบ Single sign-on จะมาแทนขั้นตอนนี้ในรุ่นถัดไป',
    token: 'โทเคนการเข้าถึง', submit: 'เข้าสู่ระบบ', cancel: 'ยกเลิก',
    demoHint: 'โทเคนทดลอง: demo-operator (ควบคุมได้), demo-viewer (ดูอย่างเดียว)',
  },
  state: {
    running: 'ทำงาน', stopped: 'หยุด', stale: 'ไม่มีข้อมูล', unknown: 'ไม่ทราบ',
    good: 'ปกติ', bad: 'คุณภาพไม่ดี', uncertain: 'ไม่แน่นอน', staleQ: 'ข้อมูลค้าง',
    updated: 'อัปเดต {{age}}', never: 'ยังไม่มีข้อมูล',
  },
  overview: {
    title: 'ภาพรวม', lede: 'ไลน์คัดแยก 1 แบบเรียลไทม์',
    lineState: 'สถานะไลน์', beltSpeed: 'ความเร็วสายพาน', motorTemp: 'อุณหภูมิสายพาน',
    binLevel: 'ระดับถังรับ', gravelRatio: 'สัดส่วนกรวด', setpoint: 'ค่าตั้งความเร็ว',
    activeAlarms: 'สัญญาณเตือนที่เกิดอยู่', recentAlarms: 'สัญญาณเตือน', openLine: 'เปิดผังไลน์',
    noActive: 'ไม่มีสัญญาณเตือน', noActiveBody: 'ไลน์ทำงานโดยไม่มีสภาวะผิดปกติ',
    stub: 'จำลอง', stubTitle: 'ยังไม่ได้เชื่อมระบบวิชัน ค่านี้เป็นค่าจำลอง',
    equipment: 'อุปกรณ์', limit: 'เตือนที่ {{v}}',
  },
  line: {
    title: 'ผังไลน์', lede: 'เลือกอุปกรณ์เพื่อดูรายละเอียด และควบคุมหากมีสิทธิ์',
    motor: 'มอเตอร์ขับ', conveyor: 'สายพานลำเลียง', camera: 'กล้องวิชัน', bin: 'ถังรับกรวด',
    inspector: 'อุปกรณ์', close: 'ปิด', signals: 'สัญญาณ', controls: 'การควบคุม',
    selectHint: 'เลือกอุปกรณ์บนผัง',
  },
  control: {
    start: 'เริ่ม', stop: 'หยุด', apply: 'ตั้งค่า', newValue: 'ค่าตั้งใหม่',
    range: 'ช่วงที่อนุญาต {{min}} ถึง {{max}} {{unit}}', current: 'ปัจจุบัน',
    confirmStartTitle: 'เริ่มสายพานหรือไม่', confirmStopTitle: 'หยุดสายพานหรือไม่',
    confirmWriteTitle: 'เปลี่ยนค่าตั้งหรือไม่',
    startConsequence: 'สายพานจะเริ่มเคลื่อนและวัสดุไหลไปที่ถังรับ ตรวจสอบว่าไลน์ปลอดภัย',
    stopConsequence: 'สายพานจะหยุด และการผลิตไลน์ 1 จะหยุดจนกว่าจะสั่งเริ่มใหม่',
    writeConsequence: 'มอเตอร์จะปรับความเร็วไปยังค่าใหม่ PLC อาจปฏิเสธค่าที่อยู่นอกขีดจำกัด',
    typeToConfirm: 'พิมพ์ {{word}} เพื่อยืนยัน',
    confirm: 'ส่งคำสั่ง', cancel: 'ยกเลิก',
    tag: 'สัญญาณ', from: 'จาก', to: 'เป็น',
    unavailable: 'ไม่สามารถควบคุมได้',
    reasonRole: 'บทบาทของคุณดูไลน์นี้ได้แต่ควบคุมไม่ได้',
    reasonGuest: 'เข้าสู่ระบบด้วยบัญชีผู้ควบคุมเพื่อสั่งงานอุปกรณ์',
    reasonViewport: 'สั่งงานอุปกรณ์ได้จากจอเวิร์กสเตชันเท่านั้น (กว้าง 768 พิกเซลขึ้นไป)',
    reasonEdge: 'เกตเวย์ edge ออฟไลน์ คำสั่งจึงไปไม่ถึง PLC',
    reasonClock: 'นาฬิกาของ edge ไม่น่าเชื่อถือ PLC จะปฏิเสธคำสั่ง',
    inFlight: 'มีคำสั่งอื่นของสัญญาณนี้กำลังดำเนินการอยู่',
    sent: 'ส่งคำสั่งแล้ว', failed: 'คำสั่งล้มเหลว: {{reason}}',
    authFailed: 'เซสชันนี้ส่งคำสั่งไม่ได้ ({{status}}) กรุณาเข้าสู่ระบบในฐานะผู้ควบคุม',
    plcFinal: 'PLC เป็นผู้ตัดสินขั้นสุดท้ายและสามารถปฏิเสธคำสั่งใดก็ได้',
    outOfRange: 'กรอกค่าตั้งแต่ {{min}} ถึง {{max}}',
  },
  lifecycle: {
    accepted: 'รับคำสั่ง', dispatched: 'ส่งถึง edge', acknowledged: 'สำเร็จ', rejected: 'ถูกปฏิเสธ',
    failed: 'ล้มเหลว', timeout: 'ไม่มีการตอบกลับ', issued: 'รับคำสั่ง', sent: 'ส่งถึง edge',
    done: 'สำเร็จ', denied: 'ถูกปฏิเสธ', acked: 'ได้รับแล้ว',
  },
  alarms: {
    title: 'สัญญาณเตือน', lede: 'จัดการสัญญาณเตือนที่เกิดอยู่ก่อน รายการที่หายแล้วจะถูกเก็บไว้เป็นประวัติ',
    active: 'เกิดอยู่', acked: 'รับทราบแล้ว', cleared: 'หายแล้ว', all: 'ทั้งหมด',
    severity: 'ระดับ', allSeverities: 'ทุกระดับ',
    critical: 'วิกฤต', warning: 'เตือน', info: 'แจ้งให้ทราบ',
    colSeverity: 'ระดับ', colAlarm: 'สัญญาณเตือน', colSignal: 'สัญญาณ', colRaised: 'เกิดเมื่อ',
    colDuration: 'ระยะเวลา', colState: 'สถานะ', colAction: 'การดำเนินการ',
    ack: 'รับทราบ', ackedBy: 'รับทราบโดย {{who}}',
    empty: 'ไม่มีสัญญาณเตือนในมุมมองนี้', emptyActive: 'ไม่มีสัญญาณเตือนที่เกิดอยู่', emptyActiveBody: 'ขณะนี้ไม่มีสิ่งที่ต้องดำเนินการ',
    ackFailed: 'รับทราบไม่สำเร็จ: {{reason}}',
    signInToAck: 'เข้าสู่ระบบในฐานะผู้ควบคุมเพื่อรับทราบ',
  },
  insights: {
    title: 'อินไซต์', advisory: 'แจ้งให้ทราบ',
    kindAnomaly: 'ความผิดปกติ', kindDrift: 'ค่าดริฟต์', kindFlatline: 'ค่านิ่งค้าง', kindFlapping: 'คุณภาพสลับถี่',
    score: 'คะแนน', open: 'เปิดอยู่', closed: 'ปิดแล้ว',
    viewAll: 'ดูทั้งหมด', empty: 'ไม่มีอินไซต์', openInTrends: 'เปิดในกราฟแนวโน้ม',
  },
  trends: {
    title: 'กราฟแนวโน้ม', lede: 'เปรียบเทียบสัญญาณตามเวลา ลากบนกราฟเพื่อซูม',
    window: 'ช่วงเวลา', time: 'เวลา', signals: 'สัญญาณ', exportCsv: 'ส่งออก CSV',
    loading: 'กำลังโหลดประวัติ', none: 'เลือกสัญญาณอย่างน้อยหนึ่งรายการ', max: 'สูงสุด 6 สัญญาณ',
    reset: 'รีเซ็ตการซูม',
  },
  tags: {
    title: 'สัญญาณ', lede: 'สัญญาณทั้งหมดของไซต์นี้ พร้อมค่าปัจจุบันและคุณภาพข้อมูล',
    search: 'ค้นหาสัญญาณ', colName: 'สัญญาณ', colPath: 'พาธ', colValue: 'ค่า',
    colQuality: 'คุณภาพ', colUpdated: 'อัปเดต', colAccess: 'สิทธิ์',
    writable: 'เขียนได้', readonly: 'อ่านอย่างเดียว', none: 'ไม่พบสัญญาณที่ตรงกับ “{{q}}”',
  },
  commands: {
    title: 'ประวัติคำสั่ง', lede: 'ทุกคำสั่งที่ส่งไปยังไลน์ ใครเป็นผู้สั่ง และผลลัพธ์เป็นอย่างไร',
    colTime: 'เวลา', colSignal: 'สัญญาณ', colValue: 'ค่า', colUser: 'ผู้สั่ง', colStatus: 'ผลลัพธ์',
    colDetail: 'รายละเอียด', empty: 'ยังไม่มีคำสั่ง', emptyBody: 'คำสั่งที่ส่งจากผังไลน์จะแสดงที่นี่',
    restricted: 'ประวัติคำสั่งดูได้เฉพาะผู้ควบคุม',
    newCommand: 'สั่งงานใหม่',
  },
  health: {
    title: 'สถานะระบบ', lede: 'การเชื่อมต่อตั้งแต่ PLC จนถึงหน้าจอนี้',
    edge: 'เกตเวย์ edge', broker: 'โบรกเกอร์ข้อความ', backend: 'แบ็กเอนด์', database: 'ฐานข้อมูล',
    browser: 'เบราว์เซอร์นี้', up: 'เชื่อมต่อแล้ว', down: 'ขาดการเชื่อมต่อ', stale: 'ไม่ส่งข้อมูล',
    clock: 'นาฬิกา edge', clockOk: 'ซิงก์แล้ว', clockBad: 'ไม่น่าเชื่อถือ',
    lastHeartbeat: 'ฮาร์ตบีตล่าสุด', uptime: 'เวลาทำงาน', wsClients: 'เซสชันสด',
    dropped: 'ข้อความที่ถูกทิ้ง', unknownTags: 'สัญญาณที่ไม่รู้จัก (ทิ้งแล้ว)',
    path: 'เส้นทางข้อมูล',
  },
  common: { retry: 'ลองอีกครั้ง', loading: 'กำลังโหลด', error: 'เกิดข้อผิดพลาด', close: 'ปิด' },
  errors: {
    load: 'โหลดข้อมูลจากแบ็กเอนด์ไม่ได้', loadBody: 'ตรวจสอบว่าแบ็กเอนด์ทำงานอยู่ แล้วลองอีกครั้ง',
  },
};

export const resources = { en: { translation: en }, th: { translation: th } };

function initialLang(): Lang {
  const saved = localStorage.getItem(LANG_KEY);
  if (saved === 'en' || saved === 'th') return saved;
  return navigator.language?.toLowerCase().startsWith('th') ? 'th' : 'en';
}

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLang(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React escapes
  returnNull: false,
});

export function setLang(lang: Lang): void {
  localStorage.setItem(LANG_KEY, lang);
  document.documentElement.lang = lang;
  void i18n.changeLanguage(lang);
}

document.documentElement.lang = i18n.language;

export default i18n;
