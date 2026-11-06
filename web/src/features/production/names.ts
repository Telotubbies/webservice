// Thai display names for the plant, shift and holiday labels the server
// seeds in English, plus Thai-aware duration text. Anything not listed
// (a customer's own names) passes through unchanged, so nothing is lost.

const TH: Record<string, string> = {
  'Sorting line 1': 'สายคัดแยก 1',
  'Mixer M1': 'เครื่องผสม M1',
  'Mixing & loading': 'ผสมและโหลดวัสดุ',
  Day: 'กะเช้า',
  Swing: 'กะบ่าย',
  Night: 'กะดึก',
  Tea: 'พักดื่มชา',
  Dinner: 'พักอาหารเย็น',
  "Father's Day (national holiday)": 'วันพ่อแห่งชาติ (วันหยุดนักขัตฤกษ์)',
  'Constitution Day': 'วันรัฐธรรมนูญ',
  "New Year's Eve": 'วันสิ้นปี',
  "New Year's Day": 'วันขึ้นปีใหม่',
};

export function localName(name: string | null | undefined, lang: string): string {
  if (!name) return '';
  return lang.startsWith('th') ? (TH[name] ?? name) : name;
}

/** "3 min" / "1.5 h", or "3 นาที" / "1.5 ชม." in Thai. */
export function fmtDuration(seconds: number, lang: string): string {
  const th = lang.startsWith('th');
  if (seconds >= 3600) return `${(seconds / 3600).toFixed(1)} ${th ? 'ชม.' : 'h'}`;
  return `${Math.round(seconds / 60)} ${th ? 'นาที' : 'min'}`;
}
