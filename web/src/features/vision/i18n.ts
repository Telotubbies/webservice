// Copy for the Models page and the per-camera model panel. Namespaced `vis`.

import i18n from '../../lib/i18n';

const en = {
  tab: 'Models', lede: 'Upload your own YOLO26 model, check its classes, and activate a version for your cameras.',
  readOnly: 'View only. Admin role is required to change models.',
  noModels: 'No models yet', noModelsHint: 'Create a model, then upload a .onnx file, or a .pt file that will be converted for you.',
  newModel: 'New model', name: 'Name', task: 'Task', task_detect: 'Detect (boxes)', task_segment: 'Segment (masks)',
  create: 'Create', cancel: 'Cancel', close: 'Close', delete: 'Delete', archive: 'Archive', activate: 'Activate',
  upload: 'Upload version', uploading: 'Uploading...', versions: 'Versions', noVersions: 'No versions yet',
  colVersion: 'Version', colStatus: 'Status', colClasses: 'Classes', colSize: 'Size', colInput: 'Input', colActions: 'Actions',
  st_processing: 'Converting...', st_draft: 'Draft', st_active: 'Active', st_archived: 'Archived', st_failed: 'Failed',
  needClasses: 'This file has no class names. Paste them, one per line, in class id order.', saveClasses: 'Save class names',
  classesPlaceholder: 'person\nbicycle\ncar', namesCount: '{{count}} names',
  errCount: 'The model has {{expected}} classes but {{got}} names were given.', errEmpty: 'Enter at least one class name.',
  errType: 'Only .onnx and .pt files are accepted.', errSize: 'The file must be between 1 byte and 500 MB.',
  errTooLarge: 'The server refused the file as too large.', errNameExists: 'A model with this name already exists.',
  errPinned: 'A camera still uses this version. Unpin it first.', errGeneric: 'Request failed: {{reason}}',
  convertHint: 'A .pt file is converted to ONNX in an isolated container. It is never opened by the main server.',
  attestTitle: 'Activate version {{v}}?', attestBody: 'Ultralytics YOLO weights are licensed under AGPL-3.0 unless your organization holds a commercial licence.',
  attest: 'My organization has the right to use this model commercially.', deleteTitle: 'Delete {{name}}?', deleteBody: 'The file is removed from storage.',
  // camera panel
  panelTitle: 'Model and classes', noModelPinned: 'No model on this camera', pickVersion: 'Model version', none: 'None',
  placement: 'Where it runs', place_auto: 'Automatic', place_edge: 'On the gateway', place_cloud: 'In the cloud',
  pin: 'Use this version', unpin: 'Remove model', diffNote: 'Upgrade changes: {{added}} added, {{removed}} removed, {{renamed}} renamed classes. Settings were kept only for unchanged classes.',
  classTable: 'Classes', colOn: 'On', colName: 'Name', colNameTh: 'Thai name', colScore: 'Min score', colColour: 'Colour', colAlert: 'Alert',
  saveClassSettings: 'Save class settings', saved: 'Saved', errScore: 'Min score must be from 0.05 to 0.95.',
  presets: 'Class sets', presetName: 'Save these settings as', savePreset: 'Save set', applyPreset: 'Apply', pickPreset: 'Choose a set',
  noActive: 'No active model versions yet. Activate one on the Models page.',
};

const th = {
  tab: 'โมเดล', lede: 'อัปโหลดโมเดล YOLO26 ของคุณเอง ตรวจสอบคลาส และเปิดใช้เวอร์ชันสำหรับกล้อง',
  readOnly: 'ดูได้อย่างเดียว ต้องมีบทบาทผู้ดูแลเพื่อแก้ไขโมเดล',
  noModels: 'ยังไม่มีโมเดล', noModelsHint: 'สร้างโมเดล แล้วอัปโหลดไฟล์ .onnx หรือไฟล์ .pt ที่ระบบจะแปลงให้',
  newModel: 'โมเดลใหม่', name: 'ชื่อ', task: 'งาน', task_detect: 'ตรวจจับ (กรอบ)', task_segment: 'แบ่งส่วน (มาสก์)',
  create: 'สร้าง', cancel: 'ยกเลิก', close: 'ปิด', delete: 'ลบ', archive: 'เก็บถาวร', activate: 'เปิดใช้งาน',
  upload: 'อัปโหลดเวอร์ชัน', uploading: 'กำลังอัปโหลด...', versions: 'เวอร์ชัน', noVersions: 'ยังไม่มีเวอร์ชัน',
  colVersion: 'เวอร์ชัน', colStatus: 'สถานะ', colClasses: 'คลาส', colSize: 'ขนาด', colInput: 'อินพุต', colActions: 'การทำงาน',
  st_processing: 'กำลังแปลง...', st_draft: 'ฉบับร่าง', st_active: 'ใช้งานอยู่', st_archived: 'เก็บถาวร', st_failed: 'ล้มเหลว',
  needClasses: 'ไฟล์นี้ไม่มีชื่อคลาส วางชื่อทีละบรรทัดตามลำดับรหัสคลาส', saveClasses: 'บันทึกชื่อคลาส',
  classesPlaceholder: 'person\nbicycle\ncar', namesCount: '{{count}} ชื่อ',
  errCount: 'โมเดลมี {{expected}} คลาส แต่ให้ชื่อมา {{got}} ชื่อ', errEmpty: 'กรอกชื่อคลาสอย่างน้อยหนึ่งชื่อ',
  errType: 'รับเฉพาะไฟล์ .onnx และ .pt', errSize: 'ไฟล์ต้องมีขนาดตั้งแต่ 1 ไบต์ถึง 500 MB',
  errTooLarge: 'เซิร์ฟเวอร์ปฏิเสธไฟล์เพราะใหญ่เกินไป', errNameExists: 'มีโมเดลชื่อนี้อยู่แล้ว',
  errPinned: 'ยังมีกล้องใช้เวอร์ชันนี้อยู่ ให้ถอดออกก่อน', errGeneric: 'คำขอล้มเหลว: {{reason}}',
  convertHint: 'ไฟล์ .pt จะถูกแปลงเป็น ONNX ในคอนเทนเนอร์แยก เซิร์ฟเวอร์หลักไม่เคยเปิดไฟล์นี้',
  attestTitle: 'เปิดใช้เวอร์ชัน {{v}}?', attestBody: 'น้ำหนักโมเดล Ultralytics YOLO อยู่ภายใต้สัญญาอนุญาต AGPL-3.0 เว้นแต่องค์กรของคุณมีสัญญาอนุญาตเชิงพาณิชย์',
  attest: 'องค์กรของฉันมีสิทธิ์ใช้โมเดลนี้ในเชิงพาณิชย์', deleteTitle: 'ลบ {{name}}?', deleteBody: 'ไฟล์จะถูกลบออกจากที่เก็บ',
  panelTitle: 'โมเดลและคลาส', noModelPinned: 'กล้องนี้ยังไม่มีโมเดล', pickVersion: 'เวอร์ชันโมเดล', none: 'ไม่มี',
  placement: 'ทำงานที่ไหน', place_auto: 'อัตโนมัติ', place_edge: 'บนเกตเวย์', place_cloud: 'บนคลาวด์',
  pin: 'ใช้เวอร์ชันนี้', unpin: 'ถอดโมเดล', diffNote: 'การอัปเกรดเปลี่ยน: เพิ่ม {{added}} ลบ {{removed}} เปลี่ยนชื่อ {{renamed}} คลาส การตั้งค่าคงไว้เฉพาะคลาสที่ไม่เปลี่ยน',
  classTable: 'คลาส', colOn: 'เปิด', colName: 'ชื่อ', colNameTh: 'ชื่อภาษาไทย', colScore: 'คะแนนขั้นต่ำ', colColour: 'สี', colAlert: 'แจ้งเตือน',
  saveClassSettings: 'บันทึกการตั้งค่าคลาส', saved: 'บันทึกแล้ว', errScore: 'คะแนนขั้นต่ำต้องอยู่ระหว่าง 0.05 ถึง 0.95',
  presets: 'ชุดคลาส', presetName: 'บันทึกการตั้งค่านี้เป็น', savePreset: 'บันทึกชุด', applyPreset: 'ใช้', pickPreset: 'เลือกชุด',
  noActive: 'ยังไม่มีเวอร์ชันโมเดลที่ใช้งานอยู่ ให้เปิดใช้งานที่หน้าโมเดล',
};

i18n.addResourceBundle('en', 'translation', { vis: en }, true, true);
i18n.addResourceBundle('th', 'translation', { vis: th }, true, true);
