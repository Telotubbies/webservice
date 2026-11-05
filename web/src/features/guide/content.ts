// User guide content, EN + TH. One array per language with the same section
// ids in the same order (content.test.ts holds them to that). Step text may
// use **bold** for the on-screen label the reader should look for; a step
// in the glossary is "term — definition".

export type Role = 'operator' | 'engineer' | 'admin';
export type Part = 'start' | 'operator' | 'engineer' | 'admin' | 'reference';
export interface GuideLink { to: string; label: string }
export interface GuideSection {
  id: string; part: Part; roles: Role[] | 'all';
  title: string; summary: string; steps: string[]; links: GuideLink[]; note?: string;
}

const en: GuideSection[] = [
  {
    id: 'start', part: 'start', roles: 'all', title: 'Find your way around',
    summary: 'The console shows one site at a time. What you need during a shift is in the top bar and the Plant group of the sidebar.',
    steps: [
      'Pick the organisation and site in the **site menu** at the top. Every page, alarm and command follows that choice.',
      'Read the top bar from left to right: **Search or jump** (Ctrl K), the current **shift**, open alarms as ▲ critical and ◆ warning counts, the plant **clock**, and the **Live** pill that says whether data is streaming.',
      'The sidebar has three groups: **Plant** for the shift (twin, overview, live, alarms, trends, production, dashboards), **Engineering** for setup (plant setup, connectivity, vision AI), and **Admin** for people and security.',
      'Change language and appearance under your **avatar → Settings**. Thai and English show the same data.',
    ],
    links: [{ to: '/', label: 'Plant twin' }, { to: '/settings', label: 'Settings' }],
    note: 'When the Live pill says Reconnecting, the values on screen are the last ones received. They are marked stale and shown as dashes, never passed off as live.',
  },
  {
    id: 'status', part: 'start', roles: 'all', title: 'Read status at a glance',
    summary: 'The console follows ISA-101: normal is grey, and colour is kept for things that need you. Every state has a shape and a word too, so nothing depends on colour alone.',
    steps: [
      '**Alarm priority:** ▲ critical, ◆ warning, ● info. A critical alarm also puts a red banner across the top until it clears.',
      '**Alarm lifecycle:** ○ active (nobody has acknowledged it), ◐ acknowledged (someone owns it, the condition is still there), ✓ cleared (back to normal).',
      '**Equipment:** running equipment is drawn dark grey and stopped equipment is outlined. Green never means running — a running machine is normal, not good news.',
      '**Data quality:** a dashed mark — ○ stale, ✚ bad, ◇ uncertain — or dashes in place of a number mean the value is not current. Treat it as unknown, not as the last number you saw.',
    ],
    links: [{ to: '/alarms', label: 'Alarms' }],
  },
  {
    id: 'twin', part: 'operator', roles: ['operator'], title: 'Watch the plant twin',
    summary: 'The home page is the plant twin: the whole site in 3D, as an HMI drawing, or as plan and front views, with live values on every mapped part.',
    steps: [
      'Switch the view with **3D · HMI · Plan · Front** at the top right. HMI is the quickest to read on a control-room screen.',
      'Click a piece of equipment, or pick it from the list, to open its **faceplate**: live signals, data quality and open alarms.',
      'In 3D, drag to orbit and scroll to zoom. **X-ray** shows equipment behind walls, **Zoom to part** frames the selection, **Isolate** hides the rest, and **Reset view** goes back.',
      'Start and stop from a faceplate go through the same confirmation and permission checks as the Line view.',
    ],
    links: [{ to: '/', label: 'Open the plant twin' }],
  },
  {
    id: 'line', part: 'operator', roles: ['operator'], title: 'Run the line from the Line view',
    summary: 'The Line view draws sorting line 1 as a process diagram with its alarm limits, next to the faceplate of the equipment you select.',
    steps: [
      'Read the drawing left to right: feeder → conveyor **CV-101** → vision camera **AT-101** → gravel bin **B-101**. The drive motor **M-101** sits on the head pulley.',
      'The bar under the belt temperature and the dashed line in the bin show how close each value is to its alarm limit (H, HH, L).',
      'Select **M-101** for the controls. **Start** and **Stop** ask you to confirm and say what will happen; a new speed must be inside the allowed range (0–60 Hz).',
      'Watch the command badge: **issued → sent → acked → done**. **Denied**, **failed** or **timeout** means the plant did not change — read the reason before you try again.',
    ],
    links: [{ to: '/line', label: 'Open the Line view' }, { to: '/commands', label: 'Command history' }],
    note: 'A lock instead of controls means this session cannot operate: your role is viewer, the live link is down, or phone control is off for your organisation.',
  },
  {
    id: 'alarms', part: 'operator', roles: ['operator'], title: 'Respond to alarms',
    summary: 'Work the alarm list from the top: it is sorted by priority, then by age.',
    steps: [
      'Open **Alarms** from the counts in the top bar or from the red banner. The **Active** tab is what still needs someone.',
      'Select rows with **Space** or the checkboxes, then press **A** or **Acknowledge** to take ownership. Acknowledging does not clear the condition — fix the cause, and the alarm clears itself once the value is back inside its deadband.',
      'Open an alarm with **Enter** to see its trend, the rule that raised it and its history. From there you can **comment**, **assign** it to someone, or **shelve** it for a set time with a reason.',
      'If the problem needs more than one person or will take a while, declare an **incident** and write down what you did, so the next shift has the whole story.',
    ],
    links: [{ to: '/alarms', label: 'Alarms' }, { to: '/incidents', label: 'Incidents' }],
    note: 'Shelving hides an alarm only for its time window, and it is audited. Use it for known nuisance alarms during maintenance, never to quiet a real problem.',
  },
  {
    id: 'stops', part: 'operator', roles: ['operator'], title: 'Classify stops and read OEE',
    summary: 'Every stop longer than the threshold waits for a reason code. The reasons feed the OEE losses the plant reviews each week.',
    steps: [
      'Open **Production → Stops**. Stops that **need a reason** are listed newest first.',
      'Pick a reason code (for example Belt cleaning or Discharge gate stuck) and add a short note if it helps the next person. You can correct it later.',
      'Open **OEE** for availability × performance × quality per machine over the last 24 hours, 7 or 30 days, with the top downtime reasons and the weekly trend.',
    ],
    links: [{ to: '/stops', label: 'Stops' }, { to: '/oee', label: 'OEE' }],
  },
  {
    id: 'handover', part: 'operator', roles: ['operator'], title: 'Hand over the shift',
    summary: 'Leave the next shift a clear picture: what ran, what stopped and what to watch.',
    steps: [
      'The shift badge in the top bar shows the current shift and when it ends.',
      'Write the handover in **Notebooks**. They take headings, lists and tables, and can be shared with the whole organisation.',
      'Open the **Shift handover** dashboard for the trends the team agreed to check, and download a **shift report** (CSV or a printable page) from **Reports**.',
    ],
    links: [{ to: '/notebooks', label: 'Notebooks' }, { to: '/dashboards', label: 'Dashboards' }, { to: '/reports', label: 'Reports' }],
  },
  {
    id: 'connect', part: 'engineer', roles: ['engineer'], title: 'Connect an edge gateway',
    summary: 'An edge gateway is a small PC next to the PLCs. It reads the machines and sends the values to the console over an encrypted MQTT link.',
    steps: [
      'Go to **Connectivity → Add device**, name the gateway, and copy the one-time **enrolment code** (valid for 30 minutes).',
      'On the gateway PC, run the **docker run** command shown on the page. The gateway enrols itself and keeps its own credential.',
      'The gateway then shows **Online** with its heartbeat and config version. **Applied v12** means it runs the latest configuration you saved.',
      'If a gateway is lost or replaced, **rotate** its credential or **disable** it. The old secret stops working at once.',
    ],
    links: [{ to: '/infrastructure/add', label: 'Add device' }, { to: '/infrastructure', label: 'Connectivity' }],
  },
  {
    id: 'sources', part: 'engineer', roles: ['engineer'], title: 'Add data sources and tags',
    summary: 'A data source is one PLC or server that the gateway polls. Each tag maps one address to a named signal under line / device / signal.',
    steps: [
      'Open the gateway, choose **Data sources → Add data source**, pick the protocol and fill in the connection. Press **Test connection** before you save.',
      '**Modbus TCP:** host, port 502 and unit id. Addresses use the usual prefixes — 0xxxx coils, 1xxxx discrete inputs, 3xxxx input registers, 4xxxx holding registers — and a **scale** turns raw register counts into units (0.1 for one decimal place).',
      '**Siemens S7:** host, rack and slot (an S7-1500 is usually rack 0, slot 1). Addresses look like DB20.DBD0 for a REAL and DB20.DBX100.0 for a bit.',
      '**OPC UA:** the endpoint (opc.tcp://host:4840), the security mode, and a user if the server needs one. Use **Browse server** to pick variables instead of typing node ids.',
      'Add tags one at a time or with **Paste CSV**. Mark a tag **writable**, with a min and a max, only if operators must be able to command it.',
    ],
    links: [{ to: '/infrastructure/sources', label: 'Data sources' }, { to: '/tags', label: 'Tags' }],
    note: 'Keep new tags read-only while commissioning. A write needs the operator role, a value inside the tag range and an explicit confirmation, and every write is audited.',
  },
  {
    id: 'rules', part: 'engineer', roles: ['engineer'], title: 'Design alarm rules people trust',
    summary: 'An alarm should mean an operator has to act. Fewer, better alarms get answered.',
    steps: [
      'Open **Alarms → Rules → New rule**, choose the tag and the kind: **Hi / HiHi / Lo / LoLo** against a limit, **stale** when data stops, or **rate of change** over a window.',
      'Set a **deadband** so a value hovering at the limit does not raise and clear over and over, and a **priority** that matches the consequence of doing nothing.',
      'Check **Alarms → Quality** every week. ISA-18.2 aims for about 6 alarms per operator-hour or fewer, and no flood of more than 10 in 10 minutes. Fix the rules flagged frequent, chattering or never acknowledged.',
      'Plan maintenance in **Downtimes** so the rules you name stay quiet while the work is done.',
    ],
    links: [{ to: '/admin/rules/new', label: 'New rule' }, { to: '/alarms/quality', label: 'Alarm quality' }, { to: '/downtimes', label: 'Downtimes' }],
  },
  {
    id: 'trends', part: 'engineer', roles: ['engineer'], title: 'Trends, dashboards and calculated tags',
    summary: 'Look back at history, build a board for each role, and derive the signals the PLC does not give you.',
    steps: [
      '**Trends** compares tags on one time axis. Long ranges switch to min / max / average buckets on their own.',
      '**Dashboards** are boards of widgets (time series, values, alarms). Share a board to make it the team’s reference; keep it private while you build it.',
      'On **Tags**, **New calculated tag** writes a formula over other tags, such as avg(a, 5m) or (a + b) / 2. The preview shows the value before you save.',
      '**Query** and **Metrics** help when you need raw samples, data gaps or quality per tag.',
    ],
    links: [{ to: '/trends', label: 'Trends' }, { to: '/dashboards', label: 'Dashboards' }, { to: '/tags', label: 'Tags' }, { to: '/query', label: 'Query' }],
  },
  {
    id: 'oee', part: 'engineer', roles: ['engineer'], title: 'Set up OEE',
    summary: 'OEE needs to know when the plant is meant to run, what each machine’s state tag means, and how fast it should go.',
    steps: [
      'In **Shifts**, define the shifts with their breaks and add the non-working days. Planned time comes from here.',
      'For each machine, map the **state tag** (which values mean running and stopped) and, if you have them, the good-count and reject tags.',
      'Enter the **ideal cycle time** per product, so performance is measured against the real target.',
      'Keep the **reason codes** short and agreed with the shift leads. Two levels (group → reason) are enough.',
    ],
    links: [{ to: '/shifts', label: 'Shifts' }, { to: '/oee', label: 'OEE' }, { to: '/stops', label: 'Reason codes' }],
  },
  {
    id: 'vision', part: 'engineer', roles: ['engineer'], title: 'Vision AI: cameras, models and rules',
    summary: 'Cameras watch the process, a model recognises what is in the frame, and rules turn detections into alarms, counts or PLC writes.',
    steps: [
      '**Cameras:** add an RTSP stream from a gateway, or upload a video to rehearse with. The list shows model state, latency and frames per second.',
      '**Models:** upload an ONNX (or YOLO .pt) file, check its classes, then **activate** it and pin the active version to a camera.',
      '**Rules:** pick the classes, a zone and how long a detection must hold, then the action. Run a new rule in **Dry run** first; a PLC write also needs cloud-write permission.',
      '**Events:** review what fired and mark each decision correct (**C**) or wrong (**W**). The reviewed set is what the next model is trained on.',
    ],
    links: [{ to: '/infrastructure/cameras', label: 'Cameras' }, { to: '/infrastructure/models', label: 'Models' }, { to: '/infrastructure/rules', label: 'Vision rules' }, { to: '/infrastructure/events', label: 'Vision events' }],
    note: 'The truck-bay camera decides gravel or sand for every load. Decisions with a low margin are flagged uncertain so a person checks them.',
  },
  {
    id: 'twinmap', part: 'engineer', roles: ['engineer'], title: 'Map your own plant model',
    summary: 'Until you upload a model, the twin shows the bundled demo plant.',
    steps: [
      'On the plant twin, choose **Edit mapping** and upload the plant as a .glb file.',
      'Select parts in the drawing, give each one a kind (motor, conveyor, vessel, valve…) and bind its roles to tags — a silo’s level to its level tag, for example.',
      'Save. Each mapped part then moves, fills or changes state from live data in all four views.',
    ],
    links: [{ to: '/line3d/map', label: 'Edit mapping' }],
  },
  {
    id: 'people', part: 'admin', roles: ['admin'], title: 'People, roles and teams',
    summary: 'Give each person the smallest role that lets them do their job.',
    steps: [
      '**Viewer** reads everything. **Operator** also acknowledges alarms, classifies stops and sends commands. **Admin** changes configuration and manages people. **Owner** also manages the plan and can delete the organisation.',
      'Invite people by email from **Admin → Users**. An invite expires if it is not accepted.',
      'Group people into **teams** (Ops and Maintenance, for example) so alarms and incidents can be routed to a team, and limit an operator to certain areas with area grants.',
      'Disable an account rather than delete it — the audit trail keeps the name.',
    ],
    links: [{ to: '/admin/users', label: 'Users' }, { to: '/teams', label: 'Teams' }],
  },
  {
    id: 'notify', part: 'admin', roles: ['admin'], title: 'Notifications and on-call',
    summary: 'Make sure the right person hears about an alarm — and that someone else does if they don’t answer.',
    steps: [
      'Add channels in **Notifications → Channels** (email, LINE, webhook) and press **Test** on each one.',
      'Route each rule to channels and teams, with the lowest priority that should notify.',
      'Build **escalation policies**: who is told first, and who is told after 15 or 45 minutes without an acknowledgement.',
      'Set the **on-call** rotation per team and add overrides for holidays and swaps.',
    ],
    links: [{ to: '/notifications/channels', label: 'Channels' }],
  },
  {
    id: 'security', part: 'admin', roles: ['admin'], title: 'Security, audit and plan',
    summary: 'Control how people sign in and what they can do from where, and keep the evidence.',
    steps: [
      'In **Security → Access**, require multi-factor sign-in, and decide whether operators may control equipment from a phone.',
      'Create **API keys** with a role and an expiry for other systems such as ERP or BI. The secret is shown once.',
      '**Admin → Audit** lists every change and command in a tamper-evident chain. Export it as CSV for an audit.',
      '**Settings → Plan** shows usage against the plan limits, and **Admin → Storage** shows what models, videos and plant files take up.',
    ],
    links: [{ to: '/security/access', label: 'Access' }, { to: '/admin/keys', label: 'API keys' }, { to: '/admin/audit', label: 'Audit' }, { to: '/settings/plan', label: 'Plan' }],
  },
  {
    id: 'shortcuts', part: 'reference', roles: 'all', title: 'Keyboard shortcuts',
    summary: 'Everything works with the mouse; these keys make a long shift faster.',
    steps: [
      '**Ctrl K** — search or jump to any page, tag or piece of equipment.',
      '**?** — show the shortcut list. **Esc** closes a dialog or panel.',
      'On **Alarms**: **Space** selects a row, **Enter** opens it, **A** acknowledges the selection.',
      'On **Vision events**: **C** marks a decision correct, **W** marks it wrong.',
    ],
    links: [],
  },
  {
    id: 'glossary', part: 'reference', roles: 'all', title: 'Glossary',
    summary: 'The words the console uses, in plant terms.',
    steps: [
      'Tag — one named signal from the plant, such as a level or a motor state.',
      'Edge gateway — the PC on site that reads the PLCs and sends their data to the console.',
      'Data source — one PLC or server a gateway reads, over Modbus TCP, Siemens S7 or OPC UA.',
      'Deadband — how far a value must come back inside its limit before an alarm clears.',
      'Shelving — hiding one alarm for a fixed time, with a reason, on the record.',
      'OEE — availability × performance × quality: how much of the planned time made good product at full speed.',
      'ISA-101 / ISA-18.2 — the standards for HMI design and for alarm management that this console follows.',
    ],
    links: [],
  },
];

const th: GuideSection[] = [
  {
    id: 'start', part: 'start', roles: 'all', title: 'เริ่มต้นใช้งาน',
    summary: 'คอนโซลแสดงข้อมูลทีละไซต์ สิ่งที่ต้องใช้ระหว่างกะอยู่ที่แถบด้านบนและกลุ่ม “โรงงาน” ในแถบเมนูด้านซ้าย',
    steps: [
      'เลือกองค์กรและไซต์จาก**เมนูไซต์**ด้านบน ทุกหน้า สัญญาณเตือน และคำสั่ง จะอ้างอิงไซต์ที่เลือกนี้',
      'อ่านแถบด้านบนจากซ้ายไปขวา: **ค้นหาหรือไปที่** (Ctrl K), **กะ**ปัจจุบัน, จำนวนสัญญาณเตือน ▲ วิกฤต และ ◆ เตือน, **นาฬิกา**ของโรงงาน และป้าย **Live** ที่บอกว่าข้อมูลยังไหลเข้ามาอยู่หรือไม่',
      'เมนูด้านซ้ายแบ่งเป็นสามกลุ่ม: **โรงงาน** สำหรับงานในกะ (ทวิน ภาพรวม หน้างานสด สัญญาณเตือน กราฟแนวโน้ม การผลิต แดชบอร์ด), **งานวิศวกรรม** สำหรับการตั้งค่า (ตั้งค่าโรงงาน การเชื่อมต่อ Vision AI) และ**ผู้ดูแล** สำหรับผู้ใช้และความปลอดภัย',
      'เปลี่ยนภาษาและรูปแบบการแสดงผลได้ที่**รูปโปรไฟล์ → ตั้งค่าบัญชี** ภาษาไทยและอังกฤษแสดงข้อมูลชุดเดียวกัน',
    ],
    links: [{ to: '/', label: 'ดิจิทัลทวินโรงงาน' }, { to: '/settings', label: 'ตั้งค่าบัญชี' }],
    note: 'ถ้าป้าย Live ขึ้นว่ากำลังเชื่อมต่อใหม่ ค่าบนจอคือค่าล่าสุดที่ได้รับ ระบบจะทำเครื่องหมายว่าไม่เป็นปัจจุบันและแสดงเป็นขีด ไม่แสดงเหมือนเป็นค่าสด',
  },
  {
    id: 'status', part: 'start', roles: 'all', title: 'อ่านสถานะให้เร็ว',
    summary: 'คอนโซลออกแบบตาม ISA-101: สภาวะปกติเป็นสีเทา สีจะใช้กับสิ่งที่ต้องการให้คุณดูเท่านั้น และทุกสถานะมีทั้งรูปทรงและข้อความกำกับ จึงไม่ต้องพึ่งสีอย่างเดียว',
    steps: [
      '**ลำดับความสำคัญ:** ▲ วิกฤต, ◆ เตือน, ● แจ้งให้ทราบ สัญญาณเตือนวิกฤตจะมีแถบสีแดงพาดด้านบนจนกว่าจะหาย',
      '**วงจรของสัญญาณเตือน:** ○ เกิดอยู่ (ยังไม่มีใครรับทราบ), ◐ รับทราบแล้ว (มีผู้รับผิดชอบแล้ว แต่สภาวะยังอยู่), ✓ หายแล้ว (กลับสู่ปกติ)',
      '**เครื่องจักร:** เครื่องที่ทำงานอยู่วาดเป็นสีเทาเข้ม เครื่องที่หยุดวาดเป็นเส้นขอบ ไม่ใช้สีเขียวแทนการทำงาน เพราะเครื่องที่เดินอยู่คือสภาวะปกติ ไม่ใช่ข่าวดี',
      '**คุณภาพข้อมูล:** ป้ายกรอบประ — ○ ข้อมูลค้าง, ✚ คุณภาพไม่ดี, ◇ ไม่แน่นอน — หรือขีดแทนตัวเลข หมายถึงค่านั้นไม่เป็นปัจจุบัน ให้ถือว่า “ไม่ทราบค่า” อย่ายึดตัวเลขล่าสุดที่เห็น',
    ],
    links: [{ to: '/alarms', label: 'สัญญาณเตือน' }],
  },
  {
    id: 'twin', part: 'operator', roles: ['operator'], title: 'ดูภาพรวมผ่านดิจิทัลทวิน',
    summary: 'หน้าแรกคือดิจิทัลทวินของโรงงาน แสดงทั้งไซต์เป็น 3 มิติ เป็นผัง HMI หรือเป็นผังด้านบนและด้านหน้า พร้อมค่าสดบนทุกชิ้นส่วนที่ผูกแท็กไว้',
    steps: [
      'สลับมุมมองด้วยปุ่ม **3D · HMI · ผังบน · ด้านหน้า** มุมขวาบน มุมมอง HMI อ่านง่ายที่สุดบนจอห้องควบคุม',
      'คลิกที่เครื่องจักร หรือเลือกจากรายการ เพื่อเปิด**เฟสเพลต** ซึ่งแสดงสัญญาณสด คุณภาพข้อมูล และสัญญาณเตือนที่ยังเปิดอยู่',
      'ในมุมมอง 3 มิติ ลากเพื่อหมุนและเลื่อนลูกกลิ้งเพื่อซูม **X-ray** มองทะลุผนัง **ซูมไปที่ชิ้นส่วน** จัดกรอบให้อุปกรณ์ที่เลือก **แยกเฉพาะ** ซ่อนส่วนอื่น และ**รีเซ็ตมุมมอง** กลับสู่มุมเริ่มต้น',
      'การสั่งเดินและหยุดจากเฟสเพลตต้องยืนยันและผ่านการตรวจสิทธิ์แบบเดียวกับหน้าผังไลน์',
    ],
    links: [{ to: '/', label: 'เปิดดิจิทัลทวิน' }],
  },
  {
    id: 'line', part: 'operator', roles: ['operator'], title: 'ควบคุมไลน์จากหน้าผังไลน์',
    summary: 'หน้าผังไลน์วาดไลน์คัดแยก 1 เป็นผังกระบวนการพร้อมขีดจำกัดสัญญาณเตือน และแสดงเฟสเพลตของอุปกรณ์ที่เลือกไว้ด้านข้าง',
    steps: [
      'อ่านผังจากซ้ายไปขวา: เครื่องป้อน → สายพาน **CV-101** → กล้องวิชัน **AT-101** → ถังรับกรวด **B-101** ส่วนมอเตอร์ขับ **M-101** ติดอยู่ที่พูลเลย์หัว',
      'แถบใต้ค่าอุณหภูมิสายพานและเส้นประในถัง บอกว่าค่านั้นเข้าใกล้ขีดจำกัดสัญญาณเตือน (H, HH, L) แค่ไหน',
      'เลือก **M-101** เพื่อเปิดปุ่มควบคุม ปุ่ม**เริ่ม**และ**หยุด**จะถามยืนยันและบอกผลที่จะเกิดขึ้น ส่วนความเร็วใหม่ต้องอยู่ในช่วงที่อนุญาต (0–60 Hz)',
      'ติดตามป้ายสถานะคำสั่ง: **issued → sent → acked → done** หากขึ้น **denied**, **failed** หรือ **timeout** แปลว่าเครื่องจักรไม่ได้เปลี่ยนตาม ให้อ่านเหตุผลก่อนสั่งซ้ำ',
    ],
    links: [{ to: '/line', label: 'เปิดผังไลน์' }, { to: '/commands', label: 'ประวัติคำสั่ง' }],
    note: 'ถ้าเห็นรูปกุญแจแทนปุ่มควบคุม แปลว่าเซสชันนี้สั่งงานไม่ได้ อาจเพราะสิทธิ์เป็นผู้ชม การเชื่อมต่อสดขาด หรือองค์กรปิดการควบคุมจากโทรศัพท์ไว้',
  },
  {
    id: 'alarms', part: 'operator', roles: ['operator'], title: 'รับมือสัญญาณเตือน',
    summary: 'ไล่จัดการรายการสัญญาณเตือนจากบนลงล่าง รายการเรียงตามลำดับความสำคัญ แล้วตามเวลาที่เกิด',
    steps: [
      'เปิดหน้า**สัญญาณเตือน**จากตัวเลขบนแถบด้านบนหรือจากแถบสีแดง แท็บ**เกิดอยู่**คือรายการที่ยังต้องมีคนจัดการ',
      'เลือกแถวด้วยปุ่ม **Space** หรือช่องติ๊ก แล้วกด **A** หรือปุ่ม**รับทราบ**เพื่อรับเป็นผู้รับผิดชอบ การรับทราบไม่ได้ทำให้สภาวะหายไป ต้องแก้ที่สาเหตุ แล้วสัญญาณเตือนจะหายเองเมื่อค่ากลับเข้าช่วงเดดแบนด์',
      'กด **Enter** เพื่อเปิดดูกราฟ กฎที่ทำให้เกิด และประวัติของสัญญาณเตือน จากหน้านี้สามารถ**แสดงความเห็น** **มอบหมาย**ให้ผู้อื่น หรือ**พักการเตือน**ชั่วคราวพร้อมระบุเหตุผล',
      'ถ้าปัญหาต้องใช้หลายคนหรือใช้เวลานาน ให้เปิด**เหตุขัดข้อง**และบันทึกสิ่งที่ทำไป กะถัดไปจะเห็นเรื่องทั้งหมด',
    ],
    links: [{ to: '/alarms', label: 'สัญญาณเตือน' }, { to: '/incidents', label: 'เหตุขัดข้อง' }],
    note: 'การพักการเตือนจะซ่อนสัญญาณเตือนเฉพาะช่วงเวลาที่กำหนดและถูกบันทึกในบันทึกตรวจสอบ ใช้กับสัญญาณเตือนรบกวนที่รู้สาเหตุอยู่แล้วระหว่างซ่อมบำรุง ห้ามใช้เพื่อปิดเสียงปัญหาจริง',
  },
  {
    id: 'stops', part: 'operator', roles: ['operator'], title: 'ระบุสาเหตุการหยุดเครื่องและอ่าน OEE',
    summary: 'ทุกครั้งที่เครื่องหยุดนานเกินเกณฑ์ ระบบจะรอให้ระบุรหัสสาเหตุ ข้อมูลนี้ใช้คำนวณความสูญเสียใน OEE ที่โรงงานทบทวนทุกสัปดาห์',
    steps: [
      'เปิด**การผลิต → การหยุดเครื่อง** รายการที่**ต้องระบุสาเหตุ**จะเรียงจากล่าสุด',
      'เลือกรหัสสาเหตุ (เช่น ทำความสะอาดสายพาน หรือประตูปล่อยวัสดุติด) และเพิ่มหมายเหตุสั้น ๆ ถ้าช่วยคนถัดไปได้ แก้ไขภายหลังได้',
      'เปิดหน้า **OEE** เพื่อดูความพร้อมใช้ × สมรรถนะ × คุณภาพ ของแต่ละเครื่องใน 24 ชั่วโมง 7 วัน หรือ 30 วันล่าสุด พร้อมสาเหตุการหยุดหลักและแนวโน้มรายสัปดาห์',
    ],
    links: [{ to: '/stops', label: 'การหยุดเครื่อง' }, { to: '/oee', label: 'OEE' }],
  },
  {
    id: 'handover', part: 'operator', roles: ['operator'], title: 'ส่งต่องานระหว่างกะ',
    summary: 'ส่งต่อให้กะถัดไปเห็นภาพชัด ว่าอะไรเดินอยู่ อะไรหยุดไป และต้องเฝ้าดูอะไร',
    steps: [
      'ป้ายกะบนแถบด้านบนบอกกะปัจจุบันและเวลาสิ้นสุดกะ',
      'เขียนบันทึกส่งต่อใน**สมุดบันทึก** ใส่หัวข้อ รายการ และตารางได้ และแชร์ให้ทั้งองค์กรเห็นได้',
      'เปิดแดชบอร์ด **Shift handover** เพื่อดูกราฟที่ทีมตกลงกันว่าต้องตรวจ และดาวน์โหลด**รายงานประจำกะ** (CSV หรือหน้าสำหรับพิมพ์) ได้จากหน้า**รายงาน**',
    ],
    links: [{ to: '/notebooks', label: 'สมุดบันทึก' }, { to: '/dashboards', label: 'แดชบอร์ด' }, { to: '/reports', label: 'รายงาน' }],
  },
  {
    id: 'connect', part: 'engineer', roles: ['engineer'], title: 'เชื่อมต่อเกตเวย์ edge',
    summary: 'เกตเวย์ edge คือคอมพิวเตอร์ขนาดเล็กที่ติดตั้งใกล้ PLC ทำหน้าที่อ่านค่าจากเครื่องจักรแล้วส่งเข้าคอนโซลผ่านการเชื่อมต่อ MQTT ที่เข้ารหัส',
    steps: [
      'ไปที่**การเชื่อมต่อ → เพิ่มอุปกรณ์** ตั้งชื่อเกตเวย์ แล้วคัดลอก**รหัสลงทะเบียน**แบบใช้ครั้งเดียว (ใช้ได้ 30 นาที)',
      'บนเครื่องเกตเวย์ ให้รันคำสั่ง **docker run** ที่แสดงบนหน้า เกตเวย์จะลงทะเบียนเองและเก็บข้อมูลรับรองของตัวเอง',
      'จากนั้นเกตเวย์จะขึ้นสถานะ**ออนไลน์** พร้อมสัญญาณชีพและเวอร์ชันการตั้งค่า **Applied v12** หมายถึงเกตเวย์ใช้การตั้งค่าล่าสุดที่บันทึกไว้แล้ว',
      'ถ้าเกตเวย์สูญหายหรือเปลี่ยนเครื่อง ให้**หมุนเวียนข้อมูลรับรอง**หรือ**ปิดใช้งาน** รหัสเดิมจะใช้ไม่ได้ทันที',
    ],
    links: [{ to: '/infrastructure/add', label: 'เพิ่มอุปกรณ์' }, { to: '/infrastructure', label: 'การเชื่อมต่อ' }],
  },
  {
    id: 'sources', part: 'engineer', roles: ['engineer'], title: 'เพิ่มแหล่งข้อมูลและแท็ก',
    summary: 'แหล่งข้อมูลคือ PLC หรือเซิร์ฟเวอร์หนึ่งตัวที่เกตเวย์อ่านค่า แท็กแต่ละตัวผูกแอดเดรสหนึ่งตำแหน่งเข้ากับสัญญาณที่มีชื่อ ในรูปแบบ ไลน์ / อุปกรณ์ / สัญญาณ',
    steps: [
      'เปิดเกตเวย์ เลือก**แหล่งข้อมูล → เพิ่มแหล่งข้อมูล** เลือกโปรโตคอลและกรอกค่าการเชื่อมต่อ แล้วกด**ทดสอบการเชื่อมต่อ**ก่อนบันทึก',
      '**Modbus TCP:** กรอกโฮสต์ พอร์ต 502 และ unit id แอดเดรสใช้คำนำหน้ามาตรฐาน — 0xxxx คอยล์, 1xxxx ดิสครีตอินพุต, 3xxxx อินพุตรีจิสเตอร์, 4xxxx โฮลดิงรีจิสเตอร์ — และใช้ค่า**สเกล**แปลงค่าดิบของรีจิสเตอร์เป็นหน่วยจริง (0.1 สำหรับทศนิยมหนึ่งตำแหน่ง)',
      '**Siemens S7:** กรอกโฮสต์ แร็ก และสล็อต (S7-1500 มักเป็นแร็ก 0 สล็อต 1) แอดเดรสมีรูปแบบเช่น DB20.DBD0 สำหรับค่า REAL และ DB20.DBX100.0 สำหรับบิต',
      '**OPC UA:** กรอก endpoint (opc.tcp://host:4840) โหมดความปลอดภัย และชื่อผู้ใช้หากเซิร์ฟเวอร์กำหนด ใช้**เรียกดูเซิร์ฟเวอร์**เพื่อเลือกตัวแปรแทนการพิมพ์ node id เอง',
      'เพิ่มแท็กทีละตัวหรือใช้**วาง CSV** ตั้งแท็กให้**เขียนได้** พร้อมค่าต่ำสุดและสูงสุด เฉพาะเมื่อผู้ควบคุมจำเป็นต้องสั่งค่านั้น',
    ],
    links: [{ to: '/infrastructure/sources', label: 'แหล่งข้อมูล' }, { to: '/tags', label: 'สัญญาณ' }],
    note: 'ระหว่างทดสอบระบบให้ตั้งแท็กใหม่เป็นอ่านอย่างเดียว การเขียนค่าต้องใช้สิทธิ์ผู้ควบคุม ค่าต้องอยู่ในช่วงของแท็ก และต้องยืนยันทุกครั้ง โดยทุกการเขียนถูกบันทึกไว้',
  },
  {
    id: 'rules', part: 'engineer', roles: ['engineer'], title: 'ออกแบบกฎเตือนที่คนเชื่อถือ',
    summary: 'สัญญาณเตือนหนึ่งครั้งควรหมายความว่าผู้ควบคุมต้องลงมือทำบางอย่าง ยิ่งเตือนน้อยแต่แม่นยำ ยิ่งมีคนตอบสนอง',
    steps: [
      'เปิด**สัญญาณเตือน → กฎเตือน → กฎใหม่** เลือกแท็กและชนิดของกฎ: **Hi / HiHi / Lo / LoLo** เทียบกับขีดจำกัด, **stale** เมื่อข้อมูลหยุดมา หรือ**อัตราการเปลี่ยนแปลง**ในช่วงเวลาที่กำหนด',
      'ตั้ง**เดดแบนด์**เพื่อไม่ให้ค่าที่แกว่งอยู่ตรงขีดจำกัดเกิดและหายซ้ำไปมา และตั้ง**ลำดับความสำคัญ**ให้ตรงกับผลที่จะเกิดถ้าไม่มีใครทำอะไร',
      'ตรวจหน้า**คุณภาพสัญญาณเตือน**ทุกสัปดาห์ ISA-18.2 ตั้งเป้าไว้ไม่เกินประมาณ 6 ครั้งต่อผู้ควบคุมต่อชั่วโมง และไม่เกิน 10 ครั้งใน 10 นาที ให้แก้กฎที่ถูกระบุว่าถี่ เกิดซ้ำ หรือไม่เคยมีคนรับทราบ',
      'วางแผนงานซ่อมบำรุงไว้ใน**ช่วงปิดเสียงเตือน** เพื่อให้กฎที่ระบุไว้เงียบระหว่างที่ทำงาน',
    ],
    links: [{ to: '/admin/rules/new', label: 'กฎใหม่' }, { to: '/alarms/quality', label: 'คุณภาพสัญญาณเตือน' }, { to: '/downtimes', label: 'ช่วงปิดเสียงเตือน' }],
  },
  {
    id: 'trends', part: 'engineer', roles: ['engineer'], title: 'กราฟแนวโน้ม แดชบอร์ด และแท็กคำนวณ',
    summary: 'ย้อนดูข้อมูลในอดีต สร้างแดชบอร์ดให้แต่ละบทบาท และสร้างสัญญาณที่ PLC ไม่ได้ให้มา',
    steps: [
      '**กราฟแนวโน้ม** เปรียบเทียบหลายแท็กบนแกนเวลาเดียวกัน เมื่อเลือกช่วงยาว ระบบจะสรุปเป็นค่าต่ำสุด / สูงสุด / เฉลี่ยให้อัตโนมัติ',
      '**แดชบอร์ด** คือกระดานที่รวมวิดเจ็ต (กราฟเวลา ค่าตัวเลข สัญญาณเตือน) แชร์แดชบอร์ดเพื่อให้เป็นหน้าอ้างอิงของทีม หรือเก็บเป็นส่วนตัวระหว่างที่ยังสร้างอยู่',
      'ในหน้า**สัญญาณ** ปุ่ม**สร้าง tag คำนวณ** ใช้เขียนสูตรจากแท็กอื่น เช่น avg(a, 5m) หรือ (a + b) / 2 ตัวอย่างค่าจะแสดงก่อนบันทึก',
      '**สืบค้นข้อมูล**และ**สรุปค่าวัด** ช่วยเมื่อต้องการดูค่าดิบ ช่วงข้อมูลขาดหาย หรือคุณภาพข้อมูลของแต่ละแท็ก',
    ],
    links: [{ to: '/trends', label: 'กราฟแนวโน้ม' }, { to: '/dashboards', label: 'แดชบอร์ด' }, { to: '/tags', label: 'สัญญาณ' }, { to: '/query', label: 'สืบค้นข้อมูล' }],
  },
  {
    id: 'oee', part: 'engineer', roles: ['engineer'], title: 'ตั้งค่า OEE',
    summary: 'การคำนวณ OEE ต้องรู้ว่าโรงงานวางแผนเดินเครื่องเมื่อไร แท็กสถานะของแต่ละเครื่องหมายถึงอะไร และเครื่องควรเดินเร็วเท่าไร',
    steps: [
      'ในหน้า**กะ** กำหนดกะพร้อมเวลาพัก และเพิ่มวันหยุด เวลาที่วางแผนเดินเครื่องคำนวณจากส่วนนี้',
      'สำหรับแต่ละเครื่อง ผูก**แท็กสถานะ** (ค่าใดหมายถึงเดินและหยุด) และถ้ามี ให้ผูกแท็กนับชิ้นงานดีและชิ้นงานเสียด้วย',
      'ใส่**รอบเวลาในอุดมคติ**ของแต่ละผลิตภัณฑ์ เพื่อวัดสมรรถนะเทียบกับเป้าหมายจริง',
      'ตั้ง**รหัสสาเหตุ**ให้สั้นและตกลงกับหัวหน้ากะ สองระดับ (กลุ่ม → สาเหตุ) ก็เพียงพอ',
    ],
    links: [{ to: '/shifts', label: 'กะ' }, { to: '/oee', label: 'OEE' }, { to: '/stops', label: 'รหัสสาเหตุ' }],
  },
  {
    id: 'vision', part: 'engineer', roles: ['engineer'], title: 'Vision AI: กล้อง โมเดล และกฎ',
    summary: 'กล้องเฝ้าดูกระบวนการ โมเดลจดจำสิ่งที่อยู่ในภาพ และกฎเปลี่ยนผลการตรวจจับให้เป็นสัญญาณเตือน การนับ หรือการเขียนค่าไปที่ PLC',
    steps: [
      '**กล้อง:** เพิ่มสตรีม RTSP จากเกตเวย์ หรืออัปโหลดวิดีโอเพื่อซ้อมทดสอบ รายการกล้องแสดงสถานะโมเดล ความหน่วง และจำนวนเฟรมต่อวินาที',
      '**โมเดล:** อัปโหลดไฟล์ ONNX (หรือ YOLO .pt) ตรวจรายชื่อคลาส แล้ว**เปิดใช้งาน** และผูกเวอร์ชันที่ใช้งานเข้ากับกล้อง',
      '**กฎ:** เลือกคลาส พื้นที่ และระยะเวลาที่ต้องตรวจพบต่อเนื่อง แล้วเลือกการกระทำ ให้ทดสอบกฎใหม่ใน**โหมดทดลอง**ก่อน และการเขียนค่าไปที่ PLC ต้องได้รับสิทธิ์เขียนจากคลาวด์ด้วย',
      '**เหตุการณ์:** ทบทวนสิ่งที่ระบบตัดสิน แล้วกด**ถูกต้อง (C)** หรือ**ผิด (W)** ชุดที่ทบทวนแล้วจะใช้ฝึกโมเดลรุ่นถัดไป',
    ],
    links: [{ to: '/infrastructure/cameras', label: 'กล้อง' }, { to: '/infrastructure/models', label: 'โมเดล' }, { to: '/infrastructure/rules', label: 'กฎ Vision' }, { to: '/infrastructure/events', label: 'เหตุการณ์ Vision' }],
    note: 'กล้องที่ช่องรถบรรทุกจะตัดสินว่าแต่ละเที่ยวเป็นกรวดหรือทราย ผลที่มีส่วนต่างน้อยจะถูกระบุว่าไม่แน่ใจ เพื่อให้คนตรวจซ้ำ',
  },
  {
    id: 'twinmap', part: 'engineer', roles: ['engineer'], title: 'ผูกโมเดลโรงงานของคุณเอง',
    summary: 'ก่อนอัปโหลดโมเดลของคุณ ทวินจะแสดงโรงงานตัวอย่างที่มากับระบบ',
    steps: [
      'ในหน้าดิจิทัลทวิน เลือก**แก้ไขการผูกอุปกรณ์** แล้วอัปโหลดโมเดลโรงงานเป็นไฟล์ .glb',
      'เลือกชิ้นส่วนในภาพ กำหนดชนิด (มอเตอร์ สายพาน ถัง วาล์ว…) และผูกบทบาทของชิ้นส่วนเข้ากับแท็ก เช่น ผูกระดับของไซโลเข้ากับแท็กระดับ',
      'บันทึก จากนั้นชิ้นส่วนที่ผูกไว้จะเคลื่อนไหว เติมระดับ หรือเปลี่ยนสถานะตามข้อมูลสดในทั้งสี่มุมมอง',
    ],
    links: [{ to: '/line3d/map', label: 'แก้ไขการผูกอุปกรณ์' }],
  },
  {
    id: 'people', part: 'admin', roles: ['admin'], title: 'ผู้ใช้ บทบาท และทีม',
    summary: 'ให้สิทธิ์แต่ละคนเท่าที่จำเป็นต่อการทำงานเท่านั้น',
    steps: [
      '**ผู้ชม** อ่านได้ทุกอย่าง **ผู้ควบคุม** รับทราบสัญญาณเตือน ระบุสาเหตุการหยุดเครื่อง และส่งคำสั่งได้ด้วย **ผู้ดูแล** เปลี่ยนการตั้งค่าและจัดการผู้ใช้ได้ **เจ้าของ** จัดการแผนบริการและลบองค์กรได้เพิ่มอีกขั้น',
      'เชิญผู้ใช้ทางอีเมลจาก**ผู้ดูแล → ผู้ใช้** คำเชิญจะหมดอายุหากไม่มีการตอบรับ',
      'จัดคนเป็น**ทีม** (เช่น ฝ่ายเดินเครื่องและฝ่ายซ่อมบำรุง) เพื่อส่งสัญญาณเตือนและเหตุขัดข้องให้ทั้งทีม และจำกัดผู้ควบคุมให้เข้าถึงเฉพาะบางพื้นที่ได้ด้วยสิทธิ์รายพื้นที่',
      'ให้ปิดใช้งานบัญชีแทนการลบ เพื่อให้บันทึกตรวจสอบยังคงชื่อผู้ใช้ไว้',
    ],
    links: [{ to: '/admin/users', label: 'ผู้ใช้' }, { to: '/teams', label: 'ทีมและกะ' }],
  },
  {
    id: 'notify', part: 'admin', roles: ['admin'], title: 'การแจ้งเตือนและเวรประจำ',
    summary: 'ให้คนที่ใช่ได้รับแจ้งเมื่อเกิดสัญญาณเตือน และให้มีคนอื่นได้รับแจ้งต่อหากไม่มีใครตอบ',
    steps: [
      'เพิ่มช่องทางที่**ช่องแจ้งเตือน** (อีเมล LINE webhook) แล้วกด**ทดสอบ**ทีละช่อง',
      'กำหนดให้แต่ละกฎส่งไปยังช่องทางและทีมที่ต้องการ พร้อมระดับความสำคัญต่ำสุดที่ต้องแจ้ง',
      'สร้าง**นโยบายการยกระดับ**: แจ้งใครก่อน และแจ้งใครต่อเมื่อผ่านไป 15 หรือ 45 นาทีโดยไม่มีคนรับทราบ',
      'ตั้ง**ตารางเวรประจำ**ของแต่ละทีม และเพิ่มการสลับเวรสำหรับวันหยุดหรือการแลกเวร',
    ],
    links: [{ to: '/notifications/channels', label: 'ช่องแจ้งเตือน' }],
  },
  {
    id: 'security', part: 'admin', roles: ['admin'], title: 'ความปลอดภัย บันทึกตรวจสอบ และแผนบริการ',
    summary: 'ควบคุมวิธีเข้าสู่ระบบและสิ่งที่ทำได้จากแต่ละที่ พร้อมเก็บหลักฐานไว้ตรวจสอบ',
    steps: [
      'ที่**การเข้าถึง** บังคับใช้การยืนยันตัวตนหลายขั้น และกำหนดว่าผู้ควบคุมสั่งงานเครื่องจักรจากโทรศัพท์ได้หรือไม่',
      'สร้าง**คีย์ API** พร้อมบทบาทและวันหมดอายุ สำหรับระบบอื่นอย่าง ERP หรือ BI รหัสลับจะแสดงเพียงครั้งเดียว',
      '**บันทึกตรวจสอบ** แสดงทุกการเปลี่ยนแปลงและทุกคำสั่งแบบสายโซ่ที่ตรวจจับการแก้ไขได้ ส่งออกเป็น CSV เพื่อใช้ในการตรวจประเมิน',
      '**แผน** แสดงการใช้งานเทียบกับขีดจำกัดของแผนบริการ ส่วน**พื้นที่จัดเก็บ** แสดงพื้นที่ที่โมเดล วิดีโอ และไฟล์โรงงานใช้อยู่',
    ],
    links: [{ to: '/security/access', label: 'การเข้าถึง' }, { to: '/admin/keys', label: 'คีย์ API' }, { to: '/admin/audit', label: 'บันทึกตรวจสอบ' }, { to: '/settings/plan', label: 'แผน' }],
  },
  {
    id: 'shortcuts', part: 'reference', roles: 'all', title: 'คีย์ลัด',
    summary: 'ทุกอย่างใช้เมาส์ได้ แต่คีย์เหล่านี้ช่วยให้ทำงานตลอดกะได้เร็วขึ้น',
    steps: [
      '**Ctrl K** — ค้นหาหรือไปยังหน้า แท็ก หรืออุปกรณ์ใดก็ได้',
      '**?** — แสดงรายการคีย์ลัด **Esc** ปิดหน้าต่างหรือแผงที่เปิดอยู่',
      'ในหน้า**สัญญาณเตือน**: **Space** เลือกแถว, **Enter** เปิดดู, **A** รับทราบรายการที่เลือก',
      'ในหน้า**เหตุการณ์ Vision**: **C** ทำเครื่องหมายว่าถูกต้อง, **W** ทำเครื่องหมายว่าผิด',
    ],
    links: [],
  },
  {
    id: 'glossary', part: 'reference', roles: 'all', title: 'อภิธานศัพท์',
    summary: 'คำที่คอนโซลใช้ อธิบายแบบงานโรงงาน',
    steps: [
      'แท็ก (Tag) — สัญญาณที่มีชื่อหนึ่งตัวจากโรงงาน เช่น ระดับในถัง หรือสถานะมอเตอร์',
      'เกตเวย์ edge — คอมพิวเตอร์ที่หน้างาน ทำหน้าที่อ่านค่าจาก PLC แล้วส่งเข้าคอนโซล',
      'แหล่งข้อมูล — PLC หรือเซิร์ฟเวอร์หนึ่งตัวที่เกตเวย์อ่าน ผ่าน Modbus TCP, Siemens S7 หรือ OPC UA',
      'เดดแบนด์ (Deadband) — ระยะที่ค่าต้องถอยกลับเข้ามาในขีดจำกัด ก่อนสัญญาณเตือนจะหาย',
      'การพักการเตือน (Shelving) — การซ่อนสัญญาณเตือนหนึ่งรายการตามเวลาที่กำหนด พร้อมเหตุผล และมีบันทึกไว้',
      'OEE — ความพร้อมใช้ × สมรรถนะ × คุณภาพ: สัดส่วนของเวลาที่วางแผนไว้ซึ่งผลิตชิ้นงานดีได้ที่ความเร็วเต็มที่',
      'ISA-101 / ISA-18.2 — มาตรฐานการออกแบบหน้าจอ HMI และการจัดการสัญญาณเตือนที่คอนโซลนี้ยึดถือ',
    ],
    links: [],
  },
];

export const GUIDE: Record<'en' | 'th', GuideSection[]> = { en, th };
export const guideFor = (lang: string) => (lang.startsWith('th') ? th : en);
