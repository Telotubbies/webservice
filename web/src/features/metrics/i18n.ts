// Metrics-suite strings (WP-B): tab labels + Overview / Volume / Settings.
// Feature-local bundle — same pattern as vizI18n / misc i18n — under `mtr.*`
// so lib/i18n.ts stays untouched except nav keys.

import i18n from '../../lib/i18n';

i18n.addResourceBundle('en', 'translation', { mtr: {
  title: 'Metrics',
  tabSummary: 'Summary', tabOverview: 'Overview', tabVolume: 'Volume', tabSettings: 'Settings',

  // overview
  ovLede: 'Every configured signal on this site and whether it is reporting.',
  ovSignals: 'Signals',
  ovConfigured: 'Configured', ovReporting: 'Reporting in 24 h', ovSilent: 'No data in 24 h',
  ovQuality: 'Latest quality',
  qGood: 'Good', qStale: 'Stale', qBad: 'Not good', qNone: 'Never reported',
  ovByEquipment: 'By equipment',
  ovFreshest: 'Most recent', ovStalest: 'Least recent',
  ovFreshBody: 'Newest and oldest received samples across all signals.',
  ovSilentTitle: 'Signals with no data in the last 24 h',
  ovSilentBody: 'Configured but no stored sample in the window — check the datasource on Infrastructure.',
  ovAllReporting: 'Every configured signal reported in the last 24 h.',
  ovOpenTrend: 'Open in Trends',
  ovWindow: '24 h window',
  ovCount_one: '{{count}} signal', ovCount_other: '{{count}} signals',

  // volume
  volLede: 'Stored samples per signal in the selected window. Counts come straight from tag-stats — nothing is estimated except the rows/day projection.',
  volWindow: 'Window',
  volTop: 'Highest-volume signals',
  volSamples: 'Samples', volRowsDay: 'Est. rows/day', volShare: 'Share', volGaps: 'Gaps',
  volSignal: 'Signal', volRate: 'Rate',
  volFlagSilent: 'silent', volFlagChatty: 'chatty',
  volFlagHint: 'silent = 0 samples in the window · chatty = projected ≥ 86,400 rows/day (≈1 sample/s sustained)',
  volTotal_one: '{{count}} sample stored', volTotal_other: '{{count}} samples stored',
  volEmpty: 'No samples stored in this window',
  volEmptyBody: 'Widen the window or check the datasource on Infrastructure.',
  volOfTotal: '{{pct}}% of all stored samples',

  // settings
  setLede: 'Read-only view of every tag configured on this site.',
  setReadonly: 'Configuration is read-only here — change tags at the datasource or ask an admin.',
  setColPath: 'Path', setColName: 'Name', setColType: 'Type', setColUnit: 'Unit', setColAccess: 'Access', setColSource: 'Source',
  setWritable: 'Writable', setReadonlyTag: 'Read only',
  setOpenSource: 'Open datasource',
  setSourcesLink: 'Data sources', setProfilesLink: 'Device profiles',
  setLinksHint: 'Tag wiring lives on Infrastructure:',
  setEmpty: 'No tags configured',
  setEmptyBody: 'The site has no tags yet — add a datasource under Infrastructure.',
  setSearchPh: 'Search path or name',
}}, true, true);

i18n.addResourceBundle('th', 'translation', { mtr: {
  title: 'ค่าวัด',
  tabSummary: 'สรุป', tabOverview: 'ภาพรวม', tabVolume: 'ปริมาณ', tabSettings: 'การตั้งค่า',

  ovLede: 'สัญญาณทุกตัวที่ตั้งค่าไว้ในไซต์นี้ และสถานะการรายงาน',
  ovSignals: 'สัญญาณ',
  ovConfigured: 'ตั้งค่าไว้', ovReporting: 'รายงานใน 24 ชม.', ovSilent: 'ไม่มีข้อมูลใน 24 ชม.',
  ovQuality: 'คุณภาพล่าสุด',
  qGood: 'ดี', qStale: 'ค้าง', qBad: 'ไม่ดี', qNone: 'ไม่เคยรายงาน',
  ovByEquipment: 'แยกตามเครื่องจักร',
  ovFreshest: 'ล่าสุดที่สุด', ovStalest: 'เก่าที่สุด',
  ovFreshBody: 'ค่าตัวอย่างที่ได้รับใหม่สุดและเก่าสุดจากสัญญาณทั้งหมด',
  ovSilentTitle: 'สัญญาณที่ไม่มีข้อมูลใน 24 ชม. ล่าสุด',
  ovSilentBody: 'ตั้งค่าไว้แต่ไม่มีค่าถูกบันทึกในช่วงนี้ — ตรวจแหล่งข้อมูลในหน้า Infrastructure',
  ovAllReporting: 'สัญญาณทุกตัวที่ตั้งค่าไว้รายงานใน 24 ชม. ล่าสุด',
  ovOpenTrend: 'เปิดในกราฟแนวโน้ม',
  ovWindow: 'ช่วง 24 ชม.',
  ovCount_one: '{{count}} สัญญาณ', ovCount_other: '{{count}} สัญญาณ',

  volLede: 'จำนวนค่าตัวอย่างที่บันทึกต่อสัญญาณในช่วงที่เลือก ตัวเลขมาจาก tag-stats โดยตรง — มีเฉพาะแถว/วันที่เป็นค่าประมาณ',
  volWindow: 'ช่วงเวลา',
  volTop: 'สัญญาณที่มีปริมาณสูงสุด',
  volSamples: 'ค่าตัวอย่าง', volRowsDay: 'แถว/วันโดยประมาณ', volShare: 'สัดส่วน', volGaps: 'ช่วงขาด',
  volSignal: 'สัญญาณ', volRate: 'อัตรา',
  volFlagSilent: 'เงียบ', volFlagChatty: 'ถี่มาก',
  volFlagHint: 'เงียบ = 0 ค่าในช่วงนี้ · ถี่มาก = คาด ≥ 86,400 แถว/วัน (≈1 ค่า/วินาทีต่อเนื่อง)',
  volTotal_one: 'บันทึก {{count}} ค่า', volTotal_other: 'บันทึก {{count}} ค่า',
  volEmpty: 'ไม่มีค่าตัวอย่างในช่วงนี้',
  volEmptyBody: 'ขยายช่วงเวลา หรือตรวจแหล่งข้อมูลในหน้า Infrastructure',
  volOfTotal: '{{pct}}% ของค่าที่บันทึกทั้งหมด',

  setLede: 'มุมมองอ่านอย่างเดียวของแท็กทั้งหมดที่ตั้งค่าในไซต์นี้',
  setReadonly: 'หน้านี้อ่านได้อย่างเดียว — แก้แท็กที่แหล่งข้อมูล หรือให้ผู้ดูแลทำ',
  setColPath: 'พาธ', setColName: 'ชื่อ', setColType: 'ชนิด', setColUnit: 'หน่วย', setColAccess: 'การเข้าถึง', setColSource: 'แหล่งข้อมูล',
  setWritable: 'เขียนได้', setReadonlyTag: 'อ่านอย่างเดียว',
  setOpenSource: 'เปิดแหล่งข้อมูล',
  setSourcesLink: 'แหล่งข้อมูล', setProfilesLink: 'โปรไฟล์อุปกรณ์',
  setLinksHint: 'การเดินสายแท็กอยู่ในหน้า Infrastructure:',
  setEmpty: 'ยังไม่มีแท็ก',
  setEmptyBody: 'ไซต์นี้ยังไม่มีแท็ก — เพิ่มแหล่งข้อมูลในหน้า Infrastructure',
  setSearchPh: 'ค้นหาพาธหรือชื่อ',
}}, true, true);
