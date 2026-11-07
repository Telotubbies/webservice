// Copy for the Overview "Connect your plant" guide. Namespaced `guide`.
// Factory I/O addresses match the "Factory I/O - Sorting" data-source
// template (features/datasources/templates.ts).

import i18n from '../../lib/i18n';

i18n.addResourceBundle('en', 'translation', {
  guide: {
    title: 'Connect your plant',
    open: 'How to connect',
    close: 'Hide the guide',
    lede: 'Three ways to get data into the console. Start with the simulator, rehearse on Factory I/O, then point the same gateway at a real PLC.',
    pathLabel: 'Data source',
    copy: 'Copy', copied: 'Copied',
    status_none: 'Waiting for a gateway. Follow the steps above; this line updates by itself.', status_wait: 'Gateway enrolled. Waiting for the first values.', status_live: 'Receiving data. You are connected.',
  noteSim: 'The demo line runs on the built-in simulator, so nothing you do here can move real equipment.',
    noteSafety: 'Keep tags read-only while commissioning. Writes need the operator role, a value inside the tag range, and an explicit confirm, and every write is audited.',
    sim: {
      tab: 'Simulator',
      intro: 'The tiles below already show live values from the built-in simulator (gateway edge1). Use it to learn the console with no hardware.',
      s1: { t: 'Look around the line', d: 'Open the 2D line view and the 3D twin. Click a piece of equipment to see its faceplate and trends.', go: 'Open line view' },
      s2: { t: 'Send a safe command', d: 'Start the motor or change the speed setpoint. You will see the confirm step, the result and the audit entry.', go: 'Open commands' },
      s3: { t: 'Add an alarm rule', d: 'Set a limit on belt temperature or bin level and watch the alarm appear on this page.', go: 'New alarm rule' },
    },
    fio: {
      tab: 'Factory I/O',
      intro: 'Factory I/O exposes its scene over Modbus TCP. The console reads it through an edge gateway, using the same path a real PLC would.',
      s1: { t: 'Start the Modbus server in Factory I/O', d: 'Open your scene, press F4 (Drivers) and pick "Modbus TCP/IP Server", port 502. Map the belt to coil 0, the pusher to coil 1, the speed setpoint to holding register 2, and the sensors to input registers 4, 6, 8 and 10. Then press Play.' },
      s2: { t: 'Enroll an edge gateway', d: 'Add device gives you a one-time code (valid 30 minutes). Run the gateway on the Factory I/O PC or any machine that can reach it.', go: 'Add device' },
      s3: { t: 'Apply the Factory I/O template', d: 'Open the gateway under Data sources and choose "Factory I/O - Sorting". It creates the tags, a dashboard and two alarm rules. Use host.docker.internal when the gateway runs in Docker on the same PC, otherwise the PC IP address.', go: 'Open data sources' },
      s4: { t: 'Check values and run the line', d: 'Values show up here within a second. Start the belt from Commands and watch Factory I/O move.', go: 'Open commands' },
    },
    plc: {
      tab: 'Real PLC',
      intro: 'A small edge gateway sits on the plant network next to the PLC. It reads Modbus TCP, Siemens S7 or OPC UA and sends values out over MQTT/TLS, so nothing on the plant side needs an inbound port.',
      s1: { t: 'Prepare the plant network', d: 'Put the gateway where it can reach the PLC (Modbus 502, S7 102, OPC UA 4840) and can reach this server on port 8883 outbound. Ask the PLC owner which addresses or nodes are safe to read.' },
      s2: { t: 'Enroll the gateway', d: 'Generate a code under Add device and start the gateway with it. It gets its own identity and can only publish into its own topics.', go: 'Add device' },
      s3: { t: 'Add the data source and tags', d: 'Pick the protocol and connection (unit ID, rack/slot, or OPC UA endpoint and security). Add tags with address, type, scale and unit. OPC UA has a browser to pick nodes.', go: 'Open data sources' },
      s4: { t: 'Model the plant, then alarm and share', d: 'Place equipment in the plant structure (area, line, equipment), build a dashboard, add alarm rules and invite your team.', go: 'Open plant structure' },
    },
  },
});

i18n.addResourceBundle('th', 'translation', {
  guide: {
    title: 'เชื่อมต่อโรงงานของคุณ',
    open: 'วิธีเชื่อมต่อ',
    close: 'ซ่อนคู่มือ',
    lede: 'นำข้อมูลเข้าคอนโซลได้ 3 แบบ เริ่มจากตัวจำลอง ซ้อมกับ Factory I/O แล้วชี้ gateway ตัวเดิมไปที่ PLC จริง',
    pathLabel: 'แหล่งข้อมูล',
    copy: 'คัดลอก', copied: 'คัดลอกแล้ว',
    status_none: 'รอเกตเวย์ ทำตามขั้นตอนด้านบน บรรทัดนี้จะอัปเดตเอง', status_wait: 'ลงทะเบียนเกตเวย์แล้ว รอค่าแรก', status_live: 'กำลังรับข้อมูล เชื่อมต่อสำเร็จ',
  noteSim: 'ไลน์เดโมทำงานบนตัวจำลองในระบบ สิ่งที่ทำในหน้านี้จึงไม่ทำให้เครื่องจักรจริงขยับ',
    noteSafety: 'ระหว่าง commissioning ให้ตั้งแท็กเป็นอ่านอย่างเดียว การเขียนค่าต้องมีบทบาท operator ค่าต้องอยู่ในช่วงของแท็ก และต้องกดยืนยัน ทุกการเขียนถูกบันทึก audit',
    sim: {
      tab: 'ตัวจำลอง',
      intro: 'การ์ดด้านล่างแสดงค่าสดจากตัวจำลองในระบบ (gateway edge1) อยู่แล้ว ใช้เรียนรู้คอนโซลได้โดยไม่ต้องมีฮาร์ดแวร์',
      s1: { t: 'สำรวจไลน์ผลิต', d: 'เปิดมุมมองไลน์ 2D และดิจิทัลทวิน 3D คลิกอุปกรณ์เพื่อดู faceplate และกราฟ', go: 'เปิดมุมมองไลน์' },
      s2: { t: 'ลองสั่งงานอย่างปลอดภัย', d: 'สั่งเดินมอเตอร์หรือเปลี่ยน speed setpoint จะเห็นขั้นตอนยืนยัน ผลลัพธ์ และบันทึก audit', go: 'เปิดหน้าสั่งงาน' },
      s3: { t: 'เพิ่มกฎแจ้งเตือน', d: 'ตั้งลิมิตอุณหภูมิสายพานหรือระดับถัง แล้วดูการแจ้งเตือนขึ้นในหน้านี้', go: 'สร้างกฎแจ้งเตือน' },
    },
    fio: {
      tab: 'Factory I/O',
      intro: 'Factory I/O ส่งข้อมูลฉากออกมาทาง Modbus TCP คอนโซลอ่านผ่าน edge gateway ด้วยเส้นทางเดียวกับ PLC จริง',
      s1: { t: 'เปิด Modbus server ใน Factory I/O', d: 'เปิดฉาก กด F4 (Drivers) เลือก "Modbus TCP/IP Server" พอร์ต 502 แมปสายพานไป coil 0, ตัวผลักไป coil 1, speed setpoint ไป holding register 2 และเซนเซอร์ไป input register 4, 6, 8 และ 10 แล้วกด Play' },
      s2: { t: 'Enrol edge gateway', d: 'หน้า Add device จะให้รหัสใช้ครั้งเดียว (อายุ 30 นาที) รัน gateway บนเครื่อง Factory I/O หรือเครื่องใดก็ได้ที่เข้าถึงได้', go: 'เพิ่มอุปกรณ์' },
      s3: { t: 'ใช้เทมเพลต Factory I/O', d: 'เปิด gateway ในหน้า Data sources แล้วเลือก "Factory I/O - Sorting" จะได้แท็ก แดชบอร์ด และกฎแจ้งเตือน 2 ข้อ ใช้ host.docker.internal ถ้า gateway รันใน Docker บนเครื่องเดียวกัน ไม่เช่นนั้นใช้ IP ของเครื่อง', go: 'เปิด Data sources' },
      s4: { t: 'ตรวจค่าและเดินไลน์', d: 'ค่าจะขึ้นในหน้านี้ภายในหนึ่งวินาที สั่งเดินสายพานจากหน้าสั่งงานแล้วดู Factory I/O ขยับ', go: 'เปิดหน้าสั่งงาน' },
    },
    plc: {
      tab: 'PLC จริง',
      intro: 'Edge gateway ขนาดเล็กวางในเครือข่ายโรงงานข้าง PLC อ่าน Modbus TCP, Siemens S7 หรือ OPC UA แล้วส่งค่าออกทาง MQTT/TLS ฝั่งโรงงานจึงไม่ต้องเปิดพอร์ตขาเข้า',
      s1: { t: 'เตรียมเครือข่ายโรงงาน', d: 'วาง gateway ให้เข้าถึง PLC ได้ (Modbus 502, S7 102, OPC UA 4840) และออกมาหาเซิร์ฟเวอร์นี้ที่พอร์ต 8883 ได้ ถามผู้ดูแล PLC ว่า address หรือ node ไหนอ่านได้อย่างปลอดภัย' },
      s2: { t: 'Enrol gateway', d: 'สร้างรหัสในหน้า Add device แล้วเปิด gateway ด้วยรหัสนั้น gateway จะได้ตัวตนของตัวเองและส่งข้อมูลได้เฉพาะ topic ของตัวเอง', go: 'เพิ่มอุปกรณ์' },
      s3: { t: 'เพิ่มแหล่งข้อมูลและแท็ก', d: 'เลือกโปรโตคอลและการเชื่อมต่อ (unit ID, rack/slot หรือ OPC UA endpoint และ security) เพิ่มแท็กพร้อม address, ชนิด, scale และหน่วย OPC UA มีตัวเลือก node ให้', go: 'เปิด Data sources' },
      s4: { t: 'จัดโครงสร้างโรงงาน แจ้งเตือน และแชร์', d: 'วางอุปกรณ์ในโครงสร้างโรงงาน (พื้นที่ ไลน์ อุปกรณ์) สร้างแดชบอร์ด เพิ่มกฎแจ้งเตือน และเชิญทีม', go: 'เปิดโครงสร้างโรงงาน' },
    },
  },
});
