// Copy for the Cameras page. Namespaced `cam`; registered on import.

import i18n from '../../lib/i18n';

const en = {
  tab: 'Cameras', lede: 'Watch live camera feeds from a gateway. Uploaded clips loop like a live camera for demos.',
  gateway: 'Gateway', add: 'Add camera', none: 'No cameras on this gateway', noneHint: 'Add an RTSP camera, or upload a short clip to use as a demo camera.',
  noneViewer: 'An admin has not added a camera here yet.', noGateways: 'No gateways yet', noGatewaysHint: 'Add a gateway first; cameras run on a gateway.',
  readOnly: 'View only. Admin role is required to change cameras.',
  statusOk: 'Live', statusError: 'Error', statusUnknown: 'Waiting for the gateway', waiting: 'Waiting for the first frame...',
  disabled: 'Disabled', enable: 'Enable', disable: 'Disable', delete: 'Remove',
  deleteTitle: 'Remove camera {{name}}?', deleteBody: 'The gateway stops reading this camera. An uploaded clip stays in the library.',
  kindRtsp: 'RTSP camera', kindUpload: 'Uploaded clip', kindRtspHint: 'A network camera on the plant LAN', kindUploadHint: 'An mp4 or webm clip that loops like a live feed',
  fName: 'Name', fUrl: 'RTSP URL', fUrlHint: 'rtsp://user:password@192.168.0.20:554/stream1. Stored encrypted and never shown again.',
  fFps: 'Frames per second to sample', fFile: 'Video file (mp4 or webm, up to 200 MB)',
  errRequired: 'Required', errScheme: 'Must start with rtsp:// or rtsps:// and include a host.',
  errType: 'Only mp4 or webm files are accepted.', errSize: 'The file must be between 1 byte and 200 MB.',
  errUnsupported: 'The server does not recognise this as an mp4 or webm video.', errTooLarge: 'The server refused the file as too large.',
  errNameExists: 'A camera with this name already exists on this gateway.', errGeneric: 'Request failed: {{reason}}',
  uploading: 'Uploading...', saving: 'Saving...', save: 'Add camera', cancel: 'Cancel', close: 'Close',
  streamLost: 'Stream interrupted. Reconnecting...',
};

const th = {
  tab: 'กล้อง', lede: 'ดูภาพสดจากกล้องผ่านเกตเวย์ คลิปที่อัปโหลดจะเล่นวนเหมือนกล้องจริงสำหรับการสาธิต',
  gateway: 'เกตเวย์', add: 'เพิ่มกล้อง', none: 'เกตเวย์นี้ยังไม่มีกล้อง', noneHint: 'เพิ่มกล้อง RTSP หรืออัปโหลดคลิปสั้น ๆ ไว้ใช้เป็นกล้องสาธิต',
  noneViewer: 'ผู้ดูแลยังไม่ได้เพิ่มกล้องที่นี่', noGateways: 'ยังไม่มีเกตเวย์', noGatewaysHint: 'เพิ่มเกตเวย์ก่อน กล้องทำงานบนเกตเวย์',
  readOnly: 'ดูได้อย่างเดียว ต้องมีบทบาทผู้ดูแลเพื่อแก้ไขกล้อง',
  statusOk: 'สด', statusError: 'ผิดพลาด', statusUnknown: 'รอเกตเวย์', waiting: 'กำลังรอเฟรมแรก...',
  disabled: 'ปิดใช้งาน', enable: 'เปิดใช้งาน', disable: 'ปิดใช้งาน', delete: 'นำออก',
  deleteTitle: 'นำกล้อง {{name}} ออก?', deleteBody: 'เกตเวย์จะหยุดอ่านกล้องนี้ คลิปที่อัปโหลดไว้ยังคงอยู่ในคลัง',
  kindRtsp: 'กล้อง RTSP', kindUpload: 'คลิปที่อัปโหลด', kindRtspHint: 'กล้องเครือข่ายในแลนของโรงงาน', kindUploadHint: 'คลิป mp4 หรือ webm ที่เล่นวนเหมือนภาพสด',
  fName: 'ชื่อ', fUrl: 'URL ของ RTSP', fUrlHint: 'rtsp://user:password@192.168.0.20:554/stream1 เก็บแบบเข้ารหัสและจะไม่แสดงอีก',
  fFps: 'จำนวนเฟรมต่อวินาทีที่สุ่มอ่าน', fFile: 'ไฟล์วิดีโอ (mp4 หรือ webm ไม่เกิน 200 MB)',
  errRequired: 'ต้องกรอก', errScheme: 'ต้องขึ้นต้นด้วย rtsp:// หรือ rtsps:// และมีชื่อโฮสต์',
  errType: 'รับเฉพาะไฟล์ mp4 หรือ webm', errSize: 'ไฟล์ต้องมีขนาดตั้งแต่ 1 ไบต์ถึง 200 MB',
  errUnsupported: 'เซิร์ฟเวอร์ไม่รู้จักไฟล์นี้ว่าเป็นวิดีโอ mp4 หรือ webm', errTooLarge: 'เซิร์ฟเวอร์ปฏิเสธไฟล์เพราะใหญ่เกินไป',
  errNameExists: 'เกตเวย์นี้มีกล้องชื่อนี้อยู่แล้ว', errGeneric: 'คำขอล้มเหลว: {{reason}}',
  uploading: 'กำลังอัปโหลด...', saving: 'กำลังบันทึก...', save: 'เพิ่มกล้อง', cancel: 'ยกเลิก', close: 'ปิด',
  streamLost: 'สัญญาณภาพขาด กำลังเชื่อมต่อใหม่...',
};

i18n.addResourceBundle('en', 'translation', { cam: en }, true, true);
i18n.addResourceBundle('th', 'translation', { cam: th }, true, true);
