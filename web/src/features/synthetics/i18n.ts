// Heartbeat-check copy (Synthetics analog). Namespace `syn`.
import i18n from '../../lib/i18n';

i18n.addResourceBundle('en', 'translation', { syn: {
  tabChecks: 'Checks', tabCoverage: 'Coverage', tabSettings: 'Settings',
  suites: 'Suites by equipment', passing: '{{pass}} of {{total}} passing', otherArea: 'Other',
  covTitle: 'Check coverage', covLede: 'Which signals are watched by an alarm rule, and which are watched for going silent.',
  covRules: 'Signals with an alarm rule', covStale: 'Signals watched for silence', covEdges: 'Edges reporting a heartbeat',
  colSignal: 'Signal', colRules: 'Alarm rules', colStaleRule: 'Silence rule', colLive: 'Live data', yes: 'Yes', no: 'No',
  gaps: 'Signals with no alarm rule', noGaps: 'Every signal has at least one alarm rule.', addRule: 'Add rule',
  setTitle: 'Check settings', setLede: 'How a check decides pass or fail. These windows are fixed in the app today.',
  setSignal: 'Signal check', setSignalBody: 'Passing means a good-quality sample arrived within {{s}} seconds. Older is stale; a bad-quality sample fails.',
  setEdgeOnline: 'Edge online', setEdgeOnlineBody: 'A heartbeat within {{s}} seconds.',
  setEdgeStale: 'Edge stale', setEdgeStaleBody: 'No heartbeat for {{s}} to {{m}} seconds.',
  setEdgeOffline: 'Edge offline', setEdgeOfflineBody: 'No heartbeat for more than {{m}} seconds.',
  setFixed: 'Changing these windows needs a code change and a deploy. They are not stored per organization.',
  setRules: 'Per-signal silence limits live on alarm rules of type "stale".', setRulesLink: 'Open alarm rules',
} });

i18n.addResourceBundle('th', 'translation', { syn: {
  tabChecks: 'รายการตรวจ', tabCoverage: 'ความครอบคลุม', tabSettings: 'ตั้งค่า',
  suites: 'ชุดตรวจตามอุปกรณ์', passing: 'ผ่าน {{pass}} จาก {{total}}', otherArea: 'อื่น ๆ',
  covTitle: 'ความครอบคลุมของการตรวจ', covLede: 'สัญญาณใดมีกฎแจ้งเตือน และสัญญาณใดถูกเฝ้าดูเมื่อเงียบหาย',
  covRules: 'สัญญาณที่มีกฎแจ้งเตือน', covStale: 'สัญญาณที่เฝ้าดูการเงียบหาย', covEdges: 'edge ที่ส่งชีพจร',
  colSignal: 'สัญญาณ', colRules: 'กฎแจ้งเตือน', colStaleRule: 'กฎเงียบหาย', colLive: 'ข้อมูลสด', yes: 'มี', no: 'ไม่มี',
  gaps: 'สัญญาณที่ยังไม่มีกฎแจ้งเตือน', noGaps: 'ทุกสัญญาณมีกฎแจ้งเตือนอย่างน้อยหนึ่งกฎ', addRule: 'เพิ่มกฎ',
  setTitle: 'ตั้งค่าการตรวจ', setLede: 'การตัดสินว่าผ่านหรือไม่ผ่าน ช่วงเวลาเหล่านี้ถูกกำหนดตายตัวในแอปตอนนี้',
  setSignal: 'การตรวจสัญญาณ', setSignalBody: 'ผ่านคือได้ค่าคุณภาพดีภายใน {{s}} วินาที เก่ากว่านั้นคือค่าเก่า ส่วนคุณภาพไม่ดีคือไม่ผ่าน',
  setEdgeOnline: 'edge ออนไลน์', setEdgeOnlineBody: 'มีชีพจรภายใน {{s}} วินาที',
  setEdgeStale: 'edge ค่าเก่า', setEdgeStaleBody: 'ไม่มีชีพจร {{s}} ถึง {{m}} วินาที',
  setEdgeOffline: 'edge ออฟไลน์', setEdgeOfflineBody: 'ไม่มีชีพจรนานกว่า {{m}} วินาที',
  setFixed: 'การเปลี่ยนช่วงเวลาต้องแก้โค้ดและปล่อยเวอร์ชันใหม่ ไม่ได้เก็บแยกตามองค์กร',
  setRules: 'ขีดจำกัดการเงียบหายรายสัญญาณอยู่ที่กฎแจ้งเตือนชนิด "stale"', setRulesLink: 'เปิดกฎแจ้งเตือน',
} });
