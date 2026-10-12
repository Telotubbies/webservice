# Software Development Life Cycle (SDLC)

เอกสารฉบับนี้กำหนดกระบวนการพัฒนา software สำหรับโปรเจกต์ **webservice** ตั้งแต่การวางแผนจนถึงการดูแลรักษา เพื่อให้ทีมพัฒนาทำงานในแนวทางเดียวกัน ควบคุมคุณภาพได้ และลดความเสี่ยงในการส่งมอบ

---

## 1. ภาพรวม (Overview)

โปรเจกต์นี้ใช้วงจร SDLC แบบ iterative โดยแต่ละรอบ (iteration) ครอบคลุม 7 ขั้นตอนหลัก:

```
Planning → Requirements → Design → Implementation → Testing → Deployment → Maintenance
    ↑                                                                          │
    └──────────────────────── feedback loop ───────────────────────────────────┘
```

แต่ละ iteration ควรส่งมอบงานที่ใช้งานได้จริง (potentially shippable increment) และนำ feedback กลับมาปรับปรุงแผนในรอบถัดไป

---

## 2. ขั้นตอนที่ 1: Planning (วางแผน)

### วัตถุประสงค์
กำหนดขอบเขต ทรัพยากร และเป้าหมายของแต่ละ iteration

### กิจกรรม
- กำหนดวัตถุประสงค์และขอบเขตของ feature/service ที่จะพัฒนา
- ประเมิน feasibility (เทคนิค เวลา ทรัพยากร)
- ระบุ stakeholders และบทบาทความรับผิดชอบ
- จัดลำดับความสำคัญของงาน (priority)
- ระบุความเสี่ยงเบื้องต้นและแผนรับมือ

### Deliverables
- Project scope / iteration goal
- Task breakdown พร้อม estimate
- Risk register (เบื้องต้น)

### Exit Criteria
- ทีมตกลง scope และเป้าหมายร่วมกัน
- ทุกงานมี owner และ estimate

---

## 3. ขั้นตอนที่ 2: Requirements (รวบรวมความต้องการ)

### วัตถุประสงค์
แปลงความต้องการทางธุรกิจให้เป็น specification ที่พัฒนาได้จริง

### กิจกรรม
- เขียน user stories พร้อม acceptance criteria
- กำหนด functional requirements (พฤติกรรมของ API/service)
- กำหนด non-functional requirements:
  - Performance (latency, throughput)
  - Security (authentication, authorization, data protection)
  - Reliability (uptime, error handling, retry policy)
  - Scalability
- กำหนด API contract เบื้องต้น (endpoints, request/response schema)
- Review requirements กับ stakeholders

### Deliverables
- Requirement specification / user stories
- Acceptance criteria ที่ชัดเจนและทดสอบได้
- API contract draft

### Exit Criteria
- ทุก requirement มี acceptance criteria ที่วัดผลได้
- Stakeholders อนุมัติ requirements

---

## 4. ขั้นตอนที่ 3: Design (ออกแบบ)

### วัตถุประสงค์
ออกแบบสถาปัตยกรรมและรายละเอียดทางเทคนิคก่อนลงมือเขียนโค้ด

### กิจกรรม
- ออกแบบสถาปัตยกรรมระบบ (service boundaries, data flow, dependencies)
- ออกแบบ API specification (REST/GraphQL — ควรมี OpenAPI spec)
- ออกแบบ database schema และ data migration plan
- ออกแบบ security: authentication/authorization flow, secrets management, input validation
- ออกแบบ error handling และ logging/monitoring strategy
- พิจารณา design review กับทีม (สำหรับงานที่มีผลกระทบสูง)

### Deliverables
- Architecture/design document (สำหรับ feature ที่ซับซ้อน)
- API specification (เช่น OpenAPI/Swagger)
- Database schema / ERD
- Threat model หรือ security considerations (ถ้าเกี่ยวข้องกับข้อมูลสำคัญ)

### Exit Criteria
- Design ผ่านการ review
- API contract และ schema ชัดเจนพอให้เริ่ม implement ได้

---

## 5. ขั้นตอนที่ 4: Implementation (พัฒนา)

### วัตถุประสงค์
เขียนโค้ดตาม design ด้วยมาตรฐานที่กำหนด

### กิจกรรม
- พัฒนา feature บน branch แยก (feature branch workflow)
- เขียน unit tests ควบคู่กับโค้ด
- ทำ self-review และ run lint/format ก่อนเปิด pull request
- เปิด pull request พร้อมคำอธิบาย (summary + test plan)
- ผ่าน code review อย่างน้อย 1 คนก่อน merge

### Coding Standards
- ทำตาม code style/linter ของโปรเจกต์
- ไม่ commit secrets, credentials หรือข้อมูล sensitive ลง repo
- Commit message สื่อความหมาย อธิบาย "ทำไม" ไม่ใช่แค่ "ทำอะไร"
- โค้ดใหม่ต้องมี test coverage ที่เหมาะสม

### Deliverables
- Source code บน feature branch
- Unit tests
- Pull request ที่ผ่าน review

### Exit Criteria
- CI ผ่าน (build + lint + tests)
- Code review approved
- Acceptance criteria ครบ

---

## 6. ขั้นตอนที่ 5: Testing (ทดสอบ)

### วัตถุประสงค์
ยืนยันว่าระบบทำงานถูกต้องตาม requirements ก่อนปล่อยใช้งาน

### ระดับการทดสอบ
| ระดับ | สิ่งที่ทดสอบ | เครื่องมือ/วิธี |
|---|---|---|
| Unit test | ฟังก์ชัน/โมดูลแต่ละตัว | test framework ของภาษาที่ใช้ |
| Integration test | การทำงานร่วมกัน (DB, external service) | test containers, mocked services |
| API/Contract test | endpoints ตรง spec, schema ถูกต้อง | OpenAPI validation, contract tests |
| End-to-end test | flow สำคัญจากต้นจนจบ | staging environment |
| Performance test | latency, load, stress | load testing tools |
| Security test | vulnerability, auth bypass | dependency scan, SAST, manual review |

### กิจกรรม
- เขียนและ run test cases ตาม acceptance criteria
- ทดสอบ edge cases และ error scenarios
- ทดสอบบน staging environment ที่ใกล้เคียง production
- บันทึก defect และ track จนแก้ไขเสร็จ

### Exit Criteria
- Test suite ผ่านทั้งหมด ไม่มี critical/high severity defect ค้าง
- Coverage ตรงตามเกณฑ์ที่ทีมกำหนด
- Acceptance criteria ผ่านการยืนยัน

---

## 7. ขั้นตอนที่ 6: Deployment (ปล่อยใช้งาน)

### วัตถุประสงค์
ส่งมอบระบบสู่ production อย่างปลอดภัยและย้อนกลับได้

### Environments
| Environment | วัตถุประสงค์ |
|---|---|
| Local | พัฒนาและทดสอบบนเครื่องตัวเอง |
| Staging | ทดสอบรวมก่อนขึ้นจริง ตั้งค่าใกล้ production |
| Production | ใช้งานจริง |

### กิจกรรม
- Deploy ผ่าน CI/CD pipeline อัตโนมัติ (ไม่ deploy ด้วยมือโดยตรง)
- Run database migrations อย่างปลอดภัย (backward-compatible เมื่อเป็นไปได้)
- Smoke test หลัง deploy
- เตรียม rollback plan สำหรับทุก release
- ใช้ gradual rollout (เช่น canary, feature flags) สำหรับ release เสี่ยงสูง

### Deliverables
- Release notes / changelog
- Deployed service พร้อม version tag
- Rollback plan

### Exit Criteria
- Smoke test ผ่านบน production
- Monitoring/alerting ทำงานปกติ
- ไม่มี anomaly หลัง deploy ในช่วงเฝ้าสังเกต

---

## 8. ขั้นตอนที่ 7: Maintenance (ดูแลรักษา)

### วัตถุประสงค์
รักษาเสถียรภาพ ความปลอดภัย และพัฒนาต่อเนื่องหลังส่งมอบ

### กิจกรรม
- Monitoring: metrics, logs, alerts (latency, error rate, saturation)
- Incident response: แจ้ง → ระบุสาเหตุ → แก้ไข → postmortem
- แก้ไข defect ที่พบใน production ตาม severity
- อัปเดต dependencies และแพทช์ความปลอดภัยเป็นประจำ
- เก็บ feedback เพื่อนำกลับเข้า Planning ของรอบถัดไป

### Deliverables
- Incident reports / postmortems
- Maintenance log
- Feedback items เข้า backlog

---

## 9. บทบาทและความรับผิดชอบ (Roles)

| บทบาท | ความรับผิดชอบ |
|---|---|
| Product Owner | กำหนด requirements, จัด priority, ยอมรับผลลัพธ์ |
| Tech Lead / Architect | ตัดสินใจสถาปัตยกรรม, review design |
| Developer | implement, unit test, code review ซึ่งกันและกัน |
| QA | test planning, execute tests, ยืนยัน acceptance criteria |
| DevOps / SRE | CI/CD, infrastructure, monitoring, incident response |

> ในทีมขนาดเล็กหนึ่งคนอาจรับหลายบทบาท แต่ code review ควรมีคนอื่นที่ไม่ใช่ผู้เขียนตรวจเสมอ

---

## 10. Quality Gates (สรุปเกณฑ์ผ่านแต่ละ phase)

| Phase | เกณฑ์ผ่าน |
|---|---|
| Planning | scope + owner + estimate ชัดเจน |
| Requirements | acceptance criteria วัดผลได้, ได้รับอนุมัติ |
| Design | ผ่าน design review |
| Implementation | CI ผ่าน, review approved |
| Testing | tests ผ่านหมด, ไม่มี critical defect |
| Deployment | smoke test ผ่าน, monitoring ปกติ |
| Maintenance | SLA/incident จัดการตามกำหนด |

---

## 11. Versioning และ Branching

- ใช้ **Semantic Versioning**: `MAJOR.MINOR.PATCH` (เช่น `1.2.3`)
  - MAJOR: breaking change ของ API contract
  - MINOR: feature ใหม่ที่ backward-compatible
  - PATCH: bug fix
- Branching model:
  - `main` — production-ready เสมอ ป้องกัน direct push
  - `feature/<name>` — พัฒนา feature
  - `fix/<name>` — แก้ bug
  - `hotfix/<name>` — แก้เร่งด่วนบน production
- Tag ทุก release บน `main`

---

## 12. เอกสารประกอบที่ควรมี

- `README.md` — วิธี setup และ run โปรเจกต์
- API specification (OpenAPI) — อัปเดตพร้อมโค้ด
- `CHANGELOG.md` — บันทึกการเปลี่ยนแปลงแต่ละ release
- Runbook — ขั้นตอน deploy, rollback, และ incident handling
- Architecture docs — สำหรับ design ที่มีผลกระทบระยะยาว

---

*อัปเดตล่าสุด: 2026-10-10 — เอกสารนี้เป็น living document ปรับปรุงเมื่อกระบวนการทีมเปลี่ยนแปลง*
