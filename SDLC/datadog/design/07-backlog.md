# 07 — Backlog (ยังไม่ทำ) หลัง dashboards sync

| รายการ | ผู้ใช้ที่ต้องการ | Front | Back | สถานะ |
|---|---|---|---|---|
| Dashboards เก็บที่ backend + แชร์ทั้งองค์กร | ผู้จัดการ/operator | `useDashboards`, toggle แชร์, filter "Shared with me" | ตาราง `dashboards` + RLS + CRUD + audit (migration 0007) | ทำแล้ว (ยังไม่ทดสอบกับ DB จริง) |
| Notebooks (บันทึกเหตุการณ์/วิเคราะห์ + ฝังกราฟ) | ช่างซ่อมบำรุง | หน้า list + editor markdown | ตาราง `notebooks` แบบเดียวกับ dashboards | flag `notebooks` ปิดอยู่ — stub |
| Reports (สรุปรายกะ/รายวัน ส่งอีเมล) | ผู้จัดการ/เจ้าของ | หน้า Reports + ตารางเวลา | scheduler + render + SMTP | ยังไม่มี (ไม่แสดงในเมนู) |
| Downtimes ปิดเสียงแอลาร์มจริง | operator | มีหน้าแล้ว | เก็บใน DB + alarm engine ข้าม rule ที่อยู่ในช่วง | flag ปิด (in-memory) |
| SLO กำหนดเองได้ | ผู้จัดการ | ฟอร์มสร้าง SLO | ตาราง `slos` | นิยามคงที่ในโค้ด |
| Role `maintenance` | ช่างซ่อมบำรุง | — | แก้ CHECK + permission matrix | future |
| ย้ายไอคอน druids → lucide | ก่อนขาย (ลิขสิทธิ์) | `shared/ui/ddicons.ts` | — | งานค้าง 06 |
