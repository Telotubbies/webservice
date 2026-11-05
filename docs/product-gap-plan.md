# แผนพัฒนา vissointan แยกตามฟีเจอร์

สถานะ ณ 2026-11-05: ดีไซน์ทำแล้วบางส่วน แต่ยังไม่ได้เขียนโค้ดตามแผนนี้

- ดีไซน์: [Console Design Board](https://claude.ai/artifact/NU9t7xzmm2k739UfHvJGvY) แท็บ "SaaS ดีไซน์เดิม"
- งานวิจัยไอคอน ฟอนต์ และรูปแบบ UX: [reports/Console icons fonts UX patterns.md](../reports/Console%20icons%20fonts%20UX%20patterns.md)

## เป้าหมายและขอบเขต

เป้าหมายรอบนี้คือส่ง thesis และสาธิตงานหลักของโรงงานได้จริงบนโรงงานจำลอง ระบบนี้เป็นชั้นเฝ้าดูและจัดการการผลิตคู่กับ HMI เดิม ไม่ใช่ระบบ safety โดย interlock ด้าน safety ต้องอยู่ที่ PLC เสมอ

ขนาดงาน: S = เล็ก, M = กลาง, L = ใหญ่ เป็นการประเมินคร่าว ๆ ยังไม่ได้วัดเวลาจริง เลขบรรทัดอาจขยับ ให้เช็กก่อนแก้

## กติกากันงานชน

1. **หนึ่งฟีเจอร์ หนึ่ง subagent หนึ่ง worktree หนึ่ง branch** ใช้ `isolation: "worktree"` และตั้งชื่อ branch เป็น `feat/<รหัส>-<ชื่อสั้น>`
2. **แก้ได้เฉพาะไฟล์ในช่อง "เป็นเจ้าของ"** ถ้าต้องแตะไฟล์อื่น ให้หยุดและรายงาน ไม่แก้เอง
3. **ไฟล์ส่วนกลางมีผู้ประสานงานแก้คนเดียว** subagent เขียนสิ่งที่ต้องการไว้ใน "บันทึกการเชื่อมต่อ" ตอนส่งงาน
4. **เลข migration ใช้ตามที่จองไว้** ล่าสุดในระบบคือ `0054`
5. **ข้อความแปลอยู่ในโฟลเดอร์ฟีเจอร์** เช่น `web/src/features/<ฟีเจอร์>/i18n.ts` ต้องมีทั้ง EN และ TH
6. **ผู้ประสานงาน merge ทีละ branch** รันเทสต์ แล้วจึงรวม branch ถัดไป ห้าม merge พร้อมกัน รายละเอียดอยู่ใน "แผน Git"
7. **ฟีเจอร์ที่อยู่คนละรอบห้ามเริ่มก่อนรอบก่อนหน้าเสร็จ** ยกเว้นตารางระบุว่าไม่ขึ้นต่อกัน

### ไฟล์ส่วนกลาง

แก้ได้เฉพาะผู้ประสานงานตอน merge:

- `web/src/App.tsx`, `web/src/app/nav.ts`, `web/src/lib/i18n.ts`
- `web/src/dd-theme.css`, `web/src/shared/ui/*`
- `web/package.json`, `web/bun.lock`, `backend/pyproject` หรือไฟล์ dependency อื่น
- `backend/app/main.py`, `CONTRACT.v2.md`
- `docker-compose*.yml`, `.github/workflows/ci.yml`

### รูปแบบคำสั่งให้ subagent

```text
ทำฟีเจอร์ <รหัส> ตาม docs/product-gap-plan.md
แก้ได้เฉพาะไฟล์ในช่อง "เป็นเจ้าของ" ห้ามแตะไฟล์ส่วนกลาง
โหลดสกิลตามช่อง "สกิล" ก่อนเริ่ม เขียนเทสต์ก่อนโค้ด
ส่งงานพร้อมผลเทสต์จริง สิ่งที่ยังไม่ได้ตรวจ และบันทึกการเชื่อมต่อ
ห้าม merge เอง
```

## แผน Git

### สถานะ ณ 2026-11-05

- ทำงานอยู่บน `feature/plant-twin-glb` ซึ่งนำหน้า `ui-v4` อยู่ 116 commit และตรงกับ `origin`
- **ยังไม่ commit 416 รายการ:** แก้ไข 331, ลบ 7, ไฟล์ใหม่ 78 รวมการแก้ประมาณ 5,969 บรรทัดเพิ่ม และ 5,009 บรรทัดลบ
- **งานเหล่านี้อยู่ในเครื่องนี้เท่านั้น** จึงเป็นความเสี่ยงอันดับแรก
- ไม่ใช่แค่เรื่อง line ending เพราะ `--ignore-cr-at-eol` ยังเห็นไฟล์เปลี่ยน 338 ไฟล์
- Migration เดิมถูกแก้ 39 ไฟล์ ตัวอย่างที่ดูเป็นการเพิ่ม comment แต่ยังไม่ได้ตรวจครบ
- มีไฟล์ชื่อ `nul` ที่เกิดจาก error ของคำสั่ง ควรลบหลังตรวจแล้ว
- ยังไม่มี tag และ CI รันเฉพาะ `main` กับ `ui-v4`

### โครงสร้าง branch

```text
ui-v4                      branch หลัก รับงานผ่าน PR เท่านั้น
└─ integration/product-v1  รวมงานตามแผนนี้ทีละรอบ
   ├─ feat/F01-ai-plc-safety
   ├─ feat/F02-alarm-lifecycle
   └─ feat/F..-...         หนึ่งฟีเจอร์ต่อหนึ่ง branch และหนึ่ง worktree
```

### ขั้นตอนเริ่มต้น

ทำตามลำดับ และให้เจ้าของ repo ตรวจก่อน push

**1. สำรองก่อนทุกอย่าง** คำสั่งนี้ไม่แตะไฟล์ทำงานและ index จริง:

```bash
export GIT_INDEX_FILE=.git/backup-index
git read-tree HEAD
git add -A -- . ':(exclude)nul'
tree=$(git write-tree)
commit=$(git commit-tree "$tree" -p HEAD -m "backup: working tree before product plan")
unset GIT_INDEX_FILE
rm .git/backup-index
git update-ref refs/backup/pre-plan-2026-11-05 "$commit"
```

สำเนาเพิ่มนอก repo ด้วย และถ้าจะ push ref นี้ ต้องตรวจ secret ก่อน

**2. ตัดสินใจไฟล์ใหม่ก่อน commit**

| ไฟล์ | ข้อเสนอ |
|---|---|
| `nul` | ลบ และไม่ commit |
| `docker-compose.override.yml` | เก็บในเครื่อง และเพิ่มใน `.gitignore` |
| `web/.deadcode-quarantine/` | ตรวจว่ายังใช้ไหม ถ้าไม่ใช้ให้ลบ |
| `web/.impeccable/` | ไม่ commit ถ้าเป็นไฟล์ชั่วคราว |
| `MIROFISH-50-SCADA-FULL-REPORT.md` | ย้ายไป `docs/` หรือเก็บนอก repo |
| `docs/`, `reports/`, `research_notes/`, `web/PRODUCT.md` | commit เพราะใช้อ้างอิงใน thesis |
| `web/src/`, `web/mock/`, `backend/app/`, `scripts/`, `tests/e2e/` | ตรวจแล้ว commit ตามหมวดด้านล่าง |

**3. แยก commit ตามหมวด** ใช้ `git add -p` และตรวจ secret ด้วย `gitleaks` หรือ grep ก่อน

1. `chore`: เครื่องมือ, config และ `.gitattributes`
2. `docs(db)`: comment ใน migration โดยตรวจทุกไฟล์ว่าไม่เปลี่ยน schema
3. `docs(backend)` และ `fix(backend)`: แยกข้อความออกจาก logic
4. `feat(edge)`: simulator และ `edge-bridge`
5. `test`: เทสต์ที่เปลี่ยน
6. `feat(web)`: shell, เมนู และ token ก่อน แล้วค่อยแยกทีละฟีเจอร์
7. `chore(web)`: mock และไฟล์ที่ลบ
8. `docs`: แผนและรายงาน

**4. ตรวจผลรวม** รัน `bun test`, `bun run build`, `make test-contract` และเทสต์ `edge-bridge` commit ระหว่างทางอาจยัง build ไม่ผ่าน แต่จุดสุดท้ายต้องผ่าน

**5. รวมเข้าหลัก** push แล้วเปิด PR จาก `feature/plant-twin-glb` เข้า `ui-v4` รอ CI ผ่านแล้ว merge และติด tag `baseline-2026-11`

**6. เริ่มงานตามแผน** สร้าง `integration/product-v1` จาก `ui-v4` และเพิ่ม branch นี้ใน `.github/workflows/ci.yml`

### การทำงานของแต่ละฟีเจอร์

```bash
git worktree add .claude/worktrees/F02 -b feat/F02-alarm-lifecycle integration/product-v1
```

- **Subagent:** commit ใน branch ตัวเองเท่านั้น ห้าม push, merge หรือแก้ branch อื่น
- **รูปแบบ commit:** `feat(alarms): keep unacknowledged alarm after return to normal (F02)`
- **ขนาด commit:** แต่ละ commit ทำเรื่องเดียว และเทสต์ของเรื่องนั้นผ่าน
- **ก่อนส่ง:** `git rebase integration/product-v1` ได้เฉพาะ branch ของตัวเอง

### การ merge ของผู้ประสานงาน

1. รวมทีละ branch ตามลำดับรอบ
2. ใช้ `git merge --no-ff` เพื่อให้ย้อนกลับทั้งฟีเจอร์ได้
3. รันเทสต์หลังทุกการ merge และแก้ไฟล์ส่วนกลางตามบันทึกการเชื่อมต่อ
4. ครบรอบแล้วติด tag เช่น `wave-1` และเปิด PR จาก integration เข้า `ui-v4`
5. ลบ worktree กับ branch หลัง merge และยืนยันว่าไม่มีงานค้าง

### ข้อห้าม

- ห้าม force push `ui-v4` และ `integration/*` ส่วน branch ฟีเจอร์ใช้ได้แค่ `--force-with-lease` ถ้าจำเป็น
- ห้ามใช้ `--no-verify`
- ห้ามแก้ migration ที่ merge แล้ว ให้เพิ่มเลขใหม่
- ห้าม commit secret, ไฟล์ใน `backups/` และข้อมูลลูกค้า
- ห้ามใช้ `git add .` โดยไม่ตรวจ
- ห้ามลบ branch หรือ worktree เก่าโดยยังไม่ได้ตรวจตามตารางด้านล่าง

### Branch และ worktree เก่า

| รายการ | ผลตรวจ | ข้อเสนอ |
|---|---|---|
| `feature/data-sources`, `feature/dd-a`, `feature/dd-c`, `feature/dd-d`, `feature/dd-e` | merge แล้ว ตรวจไฟล์ค้างครบเฉพาะ data-sources, dd-a และ dd-e | ตรวจไฟล์ค้างที่เหลือ แล้วลบ worktree และ branch |
| `feature/datadog-parity`, `feature/design` | merge แล้ว | ลบได้หลังยืนยัน |
| `feature/dd-b` | มีงานต่างจาก HEAD 1 commit | ดูก่อนว่าต้องการไหม |
| `chore/remove-dead-code`, `feature/line-control-safety`, `feature/line-status-bar-wall`, `fix/thai-terms-and-copy`, `perf/inference-and-rollup-cpu` | ยังไม่ merge เข้า HEAD | ตรวจทีละตัว ว่าจะรวม หรือปิดทิ้ง |
| `refs/backup/pre-ui-redesign` | จุดสำรองเดิม | เก็บไว้ |

### กู้คืนเมื่อพลาด

- ฟีเจอร์ที่ merge แล้วมีปัญหา: `git revert -m 1 <merge commit>` ใน integration
- worktree เสีย: ลบ worktree แล้วสร้างใหม่จาก branch เพราะงานอยู่ใน commit แล้ว
- งานก่อนเริ่มแผนหาย: ดูจาก `refs/backup/pre-plan-2026-11-05`
- ก่อนสอบหรือเดโมใหญ่: ติด tag เช่น `thesis-demo-1` เพื่อกลับมาได้เสมอ

## แผนการเรียกสกิล

เรียกเฉพาะสกิลที่เกี่ยวข้อง สกิล Zoom, SEO, Sanity และเอกสารวิทยานิพนธ์ไม่เกี่ยวกับงานโค้ดนี้

| ใคร / เมื่อไร | สกิล |
|---|---|
| ผู้ประสานงาน | `writing-plans`, `subagent-driven-development`, `dispatching-parallel-agents`, `using-git-worktrees`, `finishing-a-development-branch` |
| ทุกฟีเจอร์ | `test-driven-development`, `verification-before-completion`, `requesting-code-review` |
| เจอบั๊กหรือเทสต์ไม่ผ่าน | `systematic-debugging` |
| งาน UI | `impeccable`, `uxui-law`, `design:design-critique`, `web-design-guidelines`, `design:accessibility-review`, `react-best-practices`, `webapp-testing` |
| กราฟ | เพิ่ม `dataviz` |
| ข้อความบนหน้าจอ | เพิ่ม `design:ux-copy` |
| Landing | เพิ่ม `design-taste-frontend`, `frontend-design`, `hallmark` |
| Backend และ schema | `engineering:testing-strategy`, `engineering:code-review` |
| คำสั่ง, สิทธิ์, ความปลอดภัย | เพิ่ม `security-review` |
| Deploy และ Cloud | `engineering:deploy-checklist`, `engineering:system-design` |
| ออกแบบโมดูลใหม่ | `codebase-design` |

## ลำดับการทำ

| รอบ | ฟีเจอร์ | ทำพร้อมกันได้ไหม |
|---|---|---|
| 0 | F00 | ทำคนเดียว ก่อนทุกงาน |
| 1 | F01, F02, F03, F04 | ได้ ไฟล์ไม่ทับกัน |
| 2 | F05, F06, F07 | ได้ F06 ต้องรอ F02 และ F04 |
| 3 | F08, F09, F10, F11 | ได้ แต่ F09 ต้องรอ F06 และ F08 |
| 4 | F12, F13, F14 | ได้ |
| 5 | F15, F16, F17 | ได้ |

ถ้าเวลาไม่พอ ให้ทำรอบ 0 ถึง 3 ก่อน ส่วน F12 เฉพาะ label กับ confusion matrix

## รอบ 0

### F00 เตรียมฐานงาน (M)

- **เป็นเจ้าของ:** ทั้ง repo ทำก่อนงานอื่น และไม่มี subagent อื่นทำงานพร้อมกัน
- **สกิล:** `using-git-worktrees`, `verification-before-completion`
- **งาน**
  - [ ] ทำตามหัวข้อ "ขั้นตอนเริ่มต้น" ใน "แผน Git" ครบ 6 ขั้น โดยถามเจ้าของก่อน push และก่อนลบไฟล์
  - [ ] จัดการ branch และ worktree เก่าตามตาราง
  - [ ] บันทึกผล `bun test`, `make test-contract` และเทสต์ใน `edge-bridge/tests`
- **เสร็จเมื่อ:** มีจุดสำรอง, `integration/product-v1` พร้อมใช้ และรู้ว่าเทสต์ใดล้มเหลวอยู่ก่อนแล้ว

## รอบ 1: จุดอันตรายและกราฟ

### F01 ความปลอดภัยของ AI ก่อนเขียน PLC (M)

- **เป็นเจ้าของ:** `edge-bridge/edge_bridge/vision/rules.py`, เทสต์ของไฟล์นี้
- **สกิล:** `security-review`
- **งาน**
  - [ ] ไม่ส่ง trigger เมื่อผลไม่แน่ใจหรือไม่มีวัสดุ (บรรทัด 421-431)
  - [ ] ถ้าเขียน `code` ไม่ผ่าน ห้ามส่ง trigger (บรรทัด 443-455)
- **เสร็จเมื่อ:** มีเทสต์ครบทั้งสองกรณี และรถคันใหม่ไม่ใช้รหัสของคันก่อน

### F02 วงจรชีวิต alarm (M)

- **เป็นเจ้าของ:** `backend/app/alarming/alarms.py`, เทสต์ของ alarm, migration `0055`
- **สกิล:** `engineering:testing-strategy`
- **งาน**
  - [ ] เพิ่มสถานะ `rtn_unack` แทนการปิด alarm ทันที (บรรทัด 306)
  - [ ] บันทึก alarm จากข้อมูลที่ส่งย้อนหลังและทำเครื่องหมายว่ามาช้า
  - [ ] ปิดหรือลบกฎแล้วไม่ทำให้ประวัติ alarm หาย
- **บันทึกการเชื่อมต่อ:** แจ้ง F06 เรื่องสถานะใหม่
- **เสร็จเมื่อ:** alarm ที่ค่ากลับปกติยังอยู่จนกว่าจะรับทราบ

### F03 ข้อมูลไม่หายตอนเน็ตล่ม (L)

- **เป็นเจ้าของ:** `edge-bridge/edge_bridge/mqtt_bridge.py`, ไฟล์ spool ใหม่ใน `edge-bridge/edge_bridge/`, เทสต์ที่เกี่ยวข้อง
- **สกิล:** `engineering:testing-strategy`
- **งาน**
  - [ ] เก็บ telemetry ลงดิสก์แทนคิวในหน่วยความจำ 500 ข้อความ
  - [ ] ส่งย้อนหลังตามลำดับหลังเชื่อมต่อใหม่ โดยไม่กลบข้อมูลสด
- **เสร็จเมื่อ:** ตัดเน็ตและรีสตาร์ต gateway แล้วข้อมูลยังครบตามขนาดบัฟเฟอร์

### F04 กราฟมาตรฐาน (M)

- **เป็นเจ้าของ:** โฟลเดอร์ใหม่ `web/src/features/charts/`, API history ใน backend ที่ตรวจพบตอนเริ่มงาน
- **สกิล:** ชุด UI + `dataviz`, `codebase-design`
- **งาน**
  - [ ] ต่อยอดจาก `web/src/features/trends/TimeChart.tsx` ด้วย uPlot โดยไม่แก้หน้า Trends ในงานนี้
  - [ ] แถบ min ถึง max จาก `mn` และ `mx`, limit, เหตุการณ์, ช่วงข้อมูลเสีย และตาราง last/min/avg/max
  - [ ] Cursor ร่วม, tooltip เฉพาะกราฟที่ชี้, ลากเพื่อซูม
  - [ ] เลือกแหล่งข้อมูล raw, `tag_rollup_1m` หรือ `tag_rollup_1h` ตามช่วงเวลา
- **บันทึกการเชื่อมต่อ:** แต่ละหน้านำกราฟไปใช้ในฟีเจอร์ของตัวเอง
- **เสร็จเมื่อ:** แสดงผลตามบอร์ด "กราฟมาตรฐาน" และเห็น spike ในช่วงเวลายาว

## รอบ 2: ควบคุม, alarm และบอร์ด 2D

### F05 คำสั่งควบคุมที่ตรวจสอบได้ (L)

- **เป็นเจ้าของ:** `backend/app/edge/commands.py`, `edge-bridge/edge_bridge/commands.py`, `web/src/features/line/`, `web/src/features/commands/`, migration `0056`
- **สกิล:** ชุด UI + `security-review`
- **งาน**
  - [ ] อ่านค่ากลับหลังเขียน และแยกสถานะ `unknown`
  - [ ] ตรวจ permissive tag ก่อนเขียน และตรวจ limit ฝั่ง server
  - [ ] ส่งเหตุผลจาก `useCommand.ts:39`
  - [ ] หน้าควบคุมมีรายการตรวจ, ผลที่คาดไว้ และปุ่มทดสอบโดยไม่ส่ง
- **เสร็จเมื่อ:** ค่าไม่ตรงหรือหมดเวลาต้องไม่ขึ้นว่าสำเร็จ และทุกคำสั่งมีเหตุผลใน audit log

### F06 หน้าจอรับมือ alarm (M)

- **ต้องรอ:** F02, F04
- **เป็นเจ้าของ:** `web/src/features/alarms/`, ส่วน shelve ใน `backend/app/alarming/notify.py`, migration `0057`
- **สกิล:** ชุด UI + `design:ux-copy`
- **งาน**
  - [ ] แก้ลิงก์ไป Trends ที่ `AlarmDetailPage.tsx:247` และไป Live ที่บรรทัด 245
  - [ ] จัดลำดับหน้าใหม่ และแสดงสาเหตุ, ผลกระทบ, ขั้นตอน, เวลาตอบสนอง
  - [ ] Shelve ต้องมีเหตุผล และจำกัดเวลา
  - [ ] แก้ข้อความผิดและ error state ใน `AlarmActions.tsx`
- **เสร็จเมื่อ:** ตรงกับบอร์ด "รายละเอียด alarm" และทำครบขั้นตอนได้โดยไม่ออกจากหน้า

### F07 บอร์ด 2D จากโมเดล 3D (L)

- **เป็นเจ้าของ:** `web/src/features/line3d/`, โฟลเดอร์ใหม่ `backend/app/plant/board*`, migration `0058`
- **สกิล:** ชุด UI + `codebase-design`, `security-review`
- **ต้นแบบที่พิสูจน์แล้ว:** แคปจาก `centrale-beton.glb` จริงได้ครบ 30 ชิ้น และบอร์ดต้นแบบทดสอบลาก, Auto layout, Undo ผ่านแล้ว
- **งาน**
  - [ ] **แคปภาพ:** กล้อง orthographic แสดงทีละชิ้น พื้นหลังโปร่งใส เลือกด้านที่กว้างกว่าอัตโนมัติ
  - [ ] **เก็บภาพ:** ผูกกับ `sha256` ของโมเดลและ node ของชิ้นส่วน ถ้าโมเดลเปลี่ยนต้องเตือนให้แคปใหม่
  - [ ] **จัดอัตโนมัติ:** ฟังก์ชันล้วน `layoutBoard(parts, boxes, groups, pinned)` ต่อยอดจาก `hmiLayout.ts` แบ่งตามพื้นที่กระบวนการ และไม่ย้ายชิ้นที่ล็อกไว้
  - [ ] **เส้นการไหล:** วาดท่อและสายพานเชื่อมเป็นเส้น ไม่ใช้ภาพท่อ และคำนวณเส้นใหม่เมื่อย้ายชิ้น
  - [ ] **ข้อมูลสด:** ใช้ `bindings` เดิมแสดงค่า, ระดับ, alarm และข้อมูลไม่สด
  - [ ] **แก้เอง:** ลากแบบ snap, ปุ่มลูกศร, ปรับขนาด, ล็อก, ซ่อน, Undo, แคปใหม่ และแก้เส้นเชื่อม
  - [ ] **เวอร์ชัน:** บันทึก draft, publish และย้อนเวอร์ชันได้ พร้อม audit log
  - [ ] **ตรวจ mapping:** แจ้งชิ้นที่ภาพเล็กหรือแตกผิดปกติ
  - [ ] **หน้าตา:** ค่าเริ่มต้นเป็นโทนเทา มีสีเฉพาะเมื่อผิดปกติ และสลับเป็นสีจริงได้
  - [ ] **คำสั่ง:** คลิกชิ้นส่วนแล้วเปิดหน้าควบคุมของ F05 ตัวบอร์ดไม่เขียนค่าลง PLC เอง
- **สคีมา:** `plant_boards(org_id, model_id, version, status, layout jsonb, created_by, created_at)` พร้อม RLS
- **เสร็จเมื่อ:** โมเดลเดโมได้บอร์ดครั้งแรกโดยไม่ต้องจัดเอง แก้แล้วบันทึกข้าม session ได้ และยังเก็บการจัดเองไว้หลังกด Auto layout กับชิ้นที่ล็อก

## รอบ 3: งานหลักของกะและการเพิ่มข้อมูล

### F08 My work (L)

- **เป็นเจ้าของ:** โฟลเดอร์ใหม่ `web/src/features/mywork/`, `backend/app/work/`, migration `0059`
- **สกิล:** ชุด UI + `codebase-design`
- **งาน:** รวม alarm, เครื่องหยุดที่ไม่มีเหตุผล และรถที่รอตรวจ เลือกงานแล้วทำต่อในหน้าเดียว
- **เสร็จเมื่อ:** งานที่ทำเสร็จหายจากรายการโดยไม่ต้องรีเฟรช

### F09 ส่งกะและเครื่องหยุด (L)

- **ต้องรอ:** F06, F08
- **เป็นเจ้าของ:** `web/src/features/production/`, `backend/app/production/`, migration `0060`
- **สกิล:** ชุด UI
- **งาน**
  - [ ] ส่งกะ: ดึงงานค้าง, ลงนามผู้ส่งและผู้รับ, แก้ย้อนหลังไม่ได้
  - [ ] หน้าเครื่องหยุดแสดง alarm และกราฟในช่วงเดียวกัน
  - [ ] OEE ลิงก์ไปรายการเครื่องหยุดที่กรองแล้ว
- **เสร็จเมื่อ:** สาธิตส่งกะครบหนึ่งรอบ และบันทึกใน audit log

### F10 เทียบทางเลือกก่อนตัดสินใจ (M)

- **เป็นเจ้าของ:** โฟลเดอร์ใหม่ `web/src/features/decisions/`, `backend/app/decisions/`, migration `0061`
- **สกิล:** ชุด UI + `dataviz`
- **งาน:** เทียบทางเลือกสำหรับไซโลใกล้หมด ระบุสูตรคำนวณ, กด Review แล้วไปหน้าคำสั่งของ F05 และบันทึกเหตุผล
- **เสร็จเมื่อ:** ตัวเลขมาจากข้อมูลจริงและอธิบายสูตรได้ โดยคนเป็นผู้ตัดสินเสมอ

### F11 เพิ่มสัญญาณและกฎ (L)

- **เป็นเจ้าของ:** `web/src/features/tags/`, `web/src/features/datasources/`, `backend/app/datasources/`, `backend/app/api/alarm_rules.py`, migration `0062`
- **สกิล:** ชุด UI + `engineering:code-review`
- **งาน**
  - [ ] ตรวจก่อนว่าโค้ด OPC UA รองรับการค้นสัญญาณแค่ไหน
  - [ ] ค้นสัญญาณ, ค่าสด, ชื่อที่เสนอ และเพิ่มทีละหลายตัว
  - [ ] ลองกฎ alarm กับข้อมูลย้อนหลัง และให้คนที่สองตรวจกฎระดับ critical
- **เสร็จเมื่อ:** ไม่ต้องสลับหน้าเพื่อเพิ่ม tag และเห็นจำนวนครั้งที่จะเตือนก่อนบันทึก

## รอบ 4: AI, Data Science และ Platform

### F12 ตรวจผลและคุณภาพโมเดล (L)

- **เป็นเจ้าของ:** `backend/app/vision/`, `edge-bridge/edge_bridge/vision/` ยกเว้น `rules.py`, `web/src/features/vision/`, migration `0063`
- **สกิล:** ชุด UI + `dataviz`
- **งาน**
  - [ ] แก้ `export_wrong` (`events.py:431`) และ `_det_area` (`material.py:112-113`)
  - [ ] เก็บ `true_material` และแสดง confusion matrix จากผลที่คนตรวจจริง
  - [ ] เก็บเฟรมที่เห็นวัสดุมากที่สุดเป็นหลักฐาน
  - [ ] เกณฑ์เปิดใช้โมเดล, rollback และตรวจ drift ของกล้อง
- **เสร็จเมื่อ:** โมเดลไม่ผ่านเกณฑ์เปิดใช้ไม่ได้ และตัวเลขมาจากข้อมูลจริง

### F13 สำรวจสัญญาณและชุดข้อมูล (L)

- **เป็นเจ้าของ:** โฟลเดอร์ใหม่ `web/src/features/explore/`, `backend/app/datasets/`, migration `0064`
- **สกิล:** ชุด UI + `dataviz`, `security-review`
- **งาน:** สำรวจสัญญาณ, สถิติ, ค่าสหสัมพันธ์ตาม lag, สร้างชุดข้อมูลแบบแบ่งตามเวลา และ export
- **เสร็จเมื่อ:** ไฟล์ export ไม่ปนข้อมูลจำลองและจำกัดเฉพาะ tenant นั้น

### F14 เมตริกและหน้าจอ Platform (L)

- **เป็นเจ้าของ:** `backend/app/core/observability.py`, `backend/app/production/ingest.py`, `backend/app/tenancy/plans.py`, `web/src/features/platform/`, `web/src/features/health/`, migration `0065`
- **สกิล:** ชุด UI + `dataviz`, `engineering:system-design`
- **งาน:** เมตริก ingest lag และอัตราข้อความ, จำกัดอัตราต่อองค์กร, รวม ingest เป็น batch, หน้าสุขภาพบริการและลูกค้า
- **เสร็จเมื่อ:** หน้าจอแสดงข้อมูลจริง และมี load test

## รอบ 5: Deploy, onboarding และ Landing

### F15 Deploy และ backup (M)

- **เป็นเจ้าของ:** `DEPLOY.md`, `scripts/`, `infra/`, `Makefile`
- **ต้องให้ผู้ประสานงานแก้:** `docker-compose*.yml`, `.github/workflows/ci.yml`
- **สกิล:** `engineering:deploy-checklist`, `security-review`
- **งาน**
  - [ ] ซ้อม deploy บนเครื่องจริง และแก้ secret ที่ขาด
  - [ ] Backup ล้มเหลวต้องไม่ลบไฟล์เก่า (`infra/backup/backup.sh:25-29`) และทดสอบ restore
  - [ ] เอาสิทธิ์อ่าน `ca.key` ออก และ mount เฉพาะ `ca.crt`
- **เสร็จเมื่อ:** ทำตามเอกสารแล้วขึ้นระบบได้ และ restore แล้วข้อมูลใช้งานได้

### F16 Onboarding และแพลน (M)

- **เป็นเจ้าของ:** `web/src/features/onboarding/`, `web/src/features/devices/`, `web/src/features/settings/`
- **สกิล:** ชุด UI + `design:ux-copy`
- **งาน:** ขั้นตอนเชื่อมโรงงาน, สถานะการเชื่อมต่อ, หน้าการใช้งานและเทียบแพลนจากลิมิตจริง
- **เสร็จเมื่อ:** ผู้ใช้ใหม่เชื่อมตัวจำลองและเห็นข้อมูลได้โดยไม่ต้องมีคนช่วย

### F17 Landing (M)

- **เป็นเจ้าของ:** `web/src/features/landing/`
- **สกิล:** ชุด UI + `design-taste-frontend`, `frontend-design`, `hallmark`
- **งาน:** ทำตามบอร์ด Landing และใช้เฉพาะความสามารถที่มีจริง
- **เสร็จเมื่อ:** ผ่านการตรวจที่ 1440 และ 390, รองรับ reduced motion และไม่มีข้อความเกินจริง

## ตารางจุดเสี่ยงชนกัน

| ไฟล์หรือโฟลเดอร์ | เจ้าของ | วิธีกันชน |
|---|---|---|
| `backend/app/alarming/alarms.py` | F02 | F06 ใช้ผลลัพธ์หลัง merge |
| `backend/app/alarming/notify.py` | F06 | F02 ห้ามแตะ |
| `edge-bridge/edge_bridge/vision/rules.py` | F01 | F12 ห้ามแตะ |
| `web/src/features/alarms/` | F06 | F04 และ F08 ใช้ผ่าน link หรือ import เท่านั้น |
| `web/src/features/production/` | F09 | F08 ใช้ผ่าน API เท่านั้น |
| หน้า Overview และ Trends | ยังไม่มีเจ้าของ | เปิดงานเปลี่ยนกราฟแยกหลัง F04 |
| `web/src/App.tsx`, `nav.ts`, `main.py` | ผู้ประสานงาน | รวมจากบันทึกการเชื่อมต่อทีละ branch |
| เลข migration | ตามที่จองไว้ | เลขชนหรือลำดับเปลี่ยนต้องให้ผู้ประสานงานตัดสิน |

## ดีไซน์ที่ยังต้องทำ

- [ ] Live ที่กดสั่งงานจากบอร์ด และ Trends เต็มหน้า
- [ ] Alarm tracker แยกตามพื้นที่ สำหรับช่วง alarm flood
- [ ] หน้าภาษาไทย และทดสอบฟอนต์ Anuphan กับผู้ใช้อายุมาก
- [ ] สถานะว่าง, error และกำลังโหลดของทุกหน้าใหม่
- [ ] เครื่องมือแคปใหม่รายชิ้นและแก้เส้นเชื่อมบนบอร์ด

## งานในอนาคต ไม่ทำในรอบนี้

ระบุในเล่ม thesis ว่าเป็นข้อจำกัดของระบบ

- สูตรผลิต, batch record และตั๋วส่งของ
- HA, failover และ deploy แบบไม่หยุดระบบ
- Alarm flood suppression, first-out และฐานข้อมูล rationalization เต็มรูปแบบ
- SMTP และระบบรับชำระเงิน
- การเทรนโมเดลในระบบ

## เรื่องที่ต้องตัดสินใจหรือหาข้อมูล

- [ ] Alarm philosophy: ลำดับความสำคัญ, สี และเวลาตอบสนอง ต้องสรุปกับวิศวกรโรงงาน
- [ ] ขั้นตอนใน alarm: ตัวอย่างในดีไซน์เป็นข้อมูลสมมติ ต้องให้ผู้รู้จริงเขียน
- [ ] ถ้าจะอ้างว่าตรงตาม ISA-18.2 หรือ ISA-101 ต้องอ่านตัวมาตรฐานจริงก่อน
- [ ] สิ่งที่ PLC ควรทำเมื่อผล AI ออกหลังรถออกไปแล้ว
- [ ] Mapping ของโมเดลเดโมที่ผิด: Dust filter 1, Belt conveyor 3, Belt conveyor 7 และ 8, Motor, Skip hoist
- [ ] ราคาแพลน และเกณฑ์ความแม่นยำของโมเดล
- [ ] สัมภาษณ์ผู้ใช้ในไทย เพราะหลักฐานเรื่องความต้องการยังน้อย
