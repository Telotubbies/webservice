// Strings for the standard chart (charts.*). Self-registering like viz/i18n.

import i18n from '../../lib/i18n';

i18n.addResourceBundle('en', 'translation', {
  charts: {
    source_raw: 'Raw samples',
    source_1m: '1-minute rollup',
    source_1h: '1-hour rollup',
    sourceHint: 'Data source for this range',
    bucket: '{{n}} per point',
    truncated: 'Showing the newest 5000 samples per request; zoom in for the rest.',
    bandName: 'Min–max band',
    gapBad: 'Bad data',
    gapMissing: 'No data',
    legendBand: 'Min to max of each point',
    stats: 'Statistics',
    statsCaption: 'Last, minimum, average and maximum of {{name}} in the shown range',
    signal: 'Signal', last: 'Last', min: 'Min', avg: 'Avg', max: 'Max',
    lastAt: 'at {{time}}',
    none: '—',
    zoomIn: 'Zoom in', zoomOut: 'Zoom out', zoomReset: 'Reset zoom',
    zoomHint: 'Drag across the chart to zoom, or use the zoom buttons.',
    zoomed: 'Zoomed to {{range}}',
    events: 'Events',
  },
}, true, true);

i18n.addResourceBundle('th', 'translation', {
  charts: {
    source_raw: 'ข้อมูลดิบ',
    source_1m: 'สรุปรายนาที',
    source_1h: 'สรุปรายชั่วโมง',
    sourceHint: 'แหล่งข้อมูลของช่วงเวลานี้',
    bucket: '{{n}} ต่อจุด',
    truncated: 'แสดงตัวอย่างล่าสุด 5000 รายการต่อคำขอ ซูมเข้าเพื่อดูส่วนที่เหลือ',
    bandName: 'แถบต่ำสุดถึงสูงสุด',
    gapBad: 'ข้อมูลเสีย',
    gapMissing: 'ไม่มีข้อมูล',
    legendBand: 'ค่าต่ำสุดถึงสูงสุดของแต่ละจุด',
    stats: 'สถิติ',
    statsCaption: 'ค่าล่าสุด ต่ำสุด เฉลี่ย และสูงสุดของ {{name}} ในช่วงที่แสดง',
    signal: 'สัญญาณ', last: 'ล่าสุด', min: 'ต่ำสุด', avg: 'เฉลี่ย', max: 'สูงสุด',
    lastAt: 'เมื่อ {{time}}',
    none: '—',
    zoomIn: 'ซูมเข้า', zoomOut: 'ซูมออก', zoomReset: 'รีเซ็ตการซูม',
    zoomHint: 'ลากบนกราฟเพื่อซูม หรือใช้ปุ่มซูม',
    zoomed: 'ซูมที่ {{range}}',
    events: 'เหตุการณ์',
  },
}, true, true);
