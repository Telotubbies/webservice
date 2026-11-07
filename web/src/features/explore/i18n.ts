// Copy for the Explore page. Namespaced `exp`.

import i18n from '../../lib/i18n';

const en = {
  title: 'Explore data', lede: 'Look at tag statistics, find which signal leads another, and save time-split datasets.',
  window: 'Window', hours: 'last {{count}} h', stats: 'Tag statistics', noTags: 'No tags with data in this window',
  col_path: 'Tag', col_min: 'Min', col_avg: 'Average', col_max: 'Max', col_count: 'Samples',
  lag: 'Lagged correlation', pickTwo: 'Tick two tags above. The first is the leader.', noLag: 'Not enough overlapping data.',
  bestLag: 'Strongest at lag {{lag}} buckets (r = {{r}}). A positive lag means the second tag follows the first.',
  datasets: 'Datasets', name: 'Dataset name', train: 'Train %', val: 'Validation %', save: 'Save with {{count}} tags',
  splitNote: 'Rows are split by time, not shuffled: the oldest go to train, then validation, the newest to test. Simulated tags are left out of exports.',
  setInfo: '{{n}} tags, split {{a}}/{{b}}/{{c}}', export: 'Export CSV', delete: 'Delete', noSets: 'No saved datasets',
};
const th = {
  title: 'สำรวจข้อมูล', lede: 'ดูสถิติของสัญญาณ หาว่าสัญญาณไหนนำสัญญาณไหน และบันทึกชุดข้อมูลที่แบ่งตามเวลา',
  window: 'ช่วงเวลา', hours: '{{count}} ชม. ล่าสุด', stats: 'สถิติสัญญาณ', noTags: 'ไม่มีสัญญาณที่มีข้อมูลในช่วงนี้',
  col_path: 'สัญญาณ', col_min: 'ต่ำสุด', col_avg: 'เฉลี่ย', col_max: 'สูงสุด', col_count: 'จำนวนตัวอย่าง',
  lag: 'สหสัมพันธ์ตามเวลาหน่วง', pickTwo: 'ติ๊กสองสัญญาณด้านบน ตัวแรกคือตัวนำ', noLag: 'ข้อมูลที่ซ้อนกันไม่พอ',
  bestLag: 'สัมพันธ์แรงสุดที่หน่วง {{lag}} ช่วง (r = {{r}}) ค่าบวกหมายถึงสัญญาณที่สองตามหลังตัวแรก',
  datasets: 'ชุดข้อมูล', name: 'ชื่อชุดข้อมูล', train: 'ฝึก %', val: 'ตรวจสอบ %', save: 'บันทึก {{count}} สัญญาณ',
  splitNote: 'แบ่งแถวตามเวลา ไม่สุ่ม: เก่าสุดเป็นชุดฝึก ถัดมาเป็นชุดตรวจสอบ ใหม่สุดเป็นชุดทดสอบ ข้อมูลจำลองจะไม่ถูกส่งออก',
  setInfo: '{{n}} สัญญาณ แบ่ง {{a}}/{{b}}/{{c}}', export: 'ส่งออก CSV', delete: 'ลบ', noSets: 'ยังไม่มีชุดข้อมูลที่บันทึก',
};

i18n.addResourceBundle('en', 'translation', { exp: en }, true, true);
i18n.addResourceBundle('th', 'translation', { exp: th }, true, true);
