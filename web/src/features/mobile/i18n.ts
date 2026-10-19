// Phone / PWA copy — namespaced `mob`.
import i18n from '../../lib/i18n';

i18n.addResourceBundle('en', 'translation', { mob: {
  navLabel: 'Quick navigation', more: 'More', activeAlarms_one: '{{count}} active alarm', activeAlarms_other: '{{count}} active alarms',
  offline: "You're offline. Values may be out of date.",
  install: 'Add to home screen to get alarm notifications', installTitle: 'Install the app',
  installIos: 'Tap the Share button, then "Add to Home Screen".', notNow: 'Not now', add: 'Add',
  title: 'Mobile notifications',
  body: 'Get a notification on this device when a new alarm needs attention. It says where the alarm is, never the readings; open the app to see details.',
  turnOn: 'Turn on for this device', turnOff: 'Turn off', test: 'Send a test', on: 'On for this device', off: 'Off',
  testSent: 'Test sent. It should arrive in a few seconds.', testNone: 'The test could not be delivered. Try turning notifications off and on again.',
  pushFailed: 'Could not change notifications. Try again.',
  denied: 'Notifications are blocked for this site. Allow them in the browser or phone settings, then come back.',
  unsupported: 'This browser cannot receive alarm notifications. Try Chrome, Edge, Firefox or Safari 16.4 or newer.',
  iosOld: 'Alarm notifications need iOS 16.4 or newer with the app added to the home screen.',
  iosTitle: 'On iPhone and iPad, add the app to your home screen first',
  ios1: 'Open this page in Safari.', ios2: 'Tap the Share button (the square with an arrow).',
  ios3: 'Choose "Add to Home Screen", then Add.', ios4: 'Open vissointan from the new icon, come back to Settings and turn notifications on.',
  privacy: 'Notifications pass through your browser vendor’s push service (Google, Apple or Mozilla). They contain no readings or tag names.',
  controlLabel: 'Show command buttons on phones',
  controlHint: 'Off by default. Commands still need the right role, area access and a recent second factor either way.',
} }, true, true);

i18n.addResourceBundle('th', 'translation', { mob: {
  navLabel: 'เมนูลัด', more: 'เพิ่มเติม', activeAlarms_one: 'มี alarm ที่ยังไม่หาย {{count}} รายการ', activeAlarms_other: 'มี alarm ที่ยังไม่หาย {{count}} รายการ',
  offline: 'ไม่มีการเชื่อมต่อ ค่าที่แสดงอาจไม่เป็นปัจจุบัน',
  install: 'เพิ่มลงหน้าจอหลักเพื่อรับการแจ้งเตือน alarm', installTitle: 'ติดตั้งแอป',
  installIos: 'แตะปุ่มแชร์ แล้วเลือก "เพิ่มลงหน้าจอโฮม"', notNow: 'ไว้ทีหลัง', add: 'เพิ่ม',
  title: 'การแจ้งเตือนบนมือถือ',
  body: 'รับการแจ้งเตือนบนอุปกรณ์นี้เมื่อมี alarm ใหม่ที่ต้องดู ข้อความบอกแค่ว่า alarm อยู่ที่ไหน ไม่มีค่าที่วัดได้ เปิดแอปเพื่อดูรายละเอียด',
  turnOn: 'เปิดสำหรับอุปกรณ์นี้', turnOff: 'ปิด', test: 'ส่งการแจ้งเตือนทดสอบ', on: 'เปิดอยู่บนอุปกรณ์นี้', off: 'ปิดอยู่',
  testSent: 'ส่งทดสอบแล้ว ควรเด้งขึ้นภายในไม่กี่วินาที', testNone: 'ส่งการแจ้งเตือนทดสอบไม่สำเร็จ ลองปิดแล้วเปิดใหม่',
  pushFailed: 'เปลี่ยนการแจ้งเตือนไม่ได้ ลองอีกครั้ง',
  denied: 'เบราว์เซอร์บล็อกการแจ้งเตือนของเว็บนี้ไว้ ไปอนุญาตในการตั้งค่าเบราว์เซอร์หรือมือถือ แล้วกลับมาที่หน้านี้',
  unsupported: 'เบราว์เซอร์นี้รับการแจ้งเตือน alarm ไม่ได้ ลอง Chrome, Edge, Firefox หรือ Safari 16.4 ขึ้นไป',
  iosOld: 'การแจ้งเตือน alarm ต้องใช้ iOS 16.4 ขึ้นไป และเพิ่มแอปลงหน้าจอโฮมก่อน',
  iosTitle: 'บน iPhone และ iPad ต้องเพิ่มแอปลงหน้าจอโฮมก่อน',
  ios1: 'เปิดหน้านี้ใน Safari', ios2: 'แตะปุ่มแชร์ (สี่เหลี่ยมมีลูกศรชี้ขึ้น)',
  ios3: 'เลือก "เพิ่มลงหน้าจอโฮม" แล้วกดเพิ่ม', ios4: 'เปิด vissointan จากไอคอนใหม่ กลับมาที่การตั้งค่า แล้วเปิดการแจ้งเตือน',
  privacy: 'การแจ้งเตือนผ่านบริการ push ของผู้พัฒนาเบราว์เซอร์ (Google, Apple หรือ Mozilla) ข้อความไม่มีค่าที่วัดได้และไม่มีชื่อ tag',
  controlLabel: 'แสดงปุ่มสั่งงานบนมือถือ',
  controlHint: 'ปิดไว้เป็นค่าเริ่มต้น ไม่ว่าเปิดหรือปิด การสั่งงานยังต้องมีสิทธิ์ที่ถูกต้อง สิทธิ์รายพื้นที่ และยืนยันตัวตนสองชั้นที่เพิ่งทำ',
} }, true, true);
